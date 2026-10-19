import { randomBytes } from 'node:crypto';
import { type AuthContext, type Client, ServerError } from '@colyseus/core';
import { type SectorDefinition, isShipHullId } from '@orbit/catalog';
import {
  ClientMessage,
  ErrorCode,
  MISSION_CANCELLED_CLOSE_CODE,
  MISSION_ENDED_CLOSE_CODE,
  RoomPhase,
  ServerMessage,
  parseInventoryTransfer,
} from '@orbit/contracts';
import { errorName } from '../infrastructure/error-name';
import type { MissionLifecycle } from '../modules/expedition/expedition-service';
import type {
  MissionDirectory,
  MissionTicket,
  MissionTicketStore,
} from '../modules/mission/mission-directory';
import { MissionLoot } from '../simulation/mission-loot';
import {
  type SectorSeed,
  generateContainerLoot,
  generateOpenSector,
  newSectorSeed,
} from '../simulation/sector-generator';
import { SectorSimulation } from '../simulation/sector-simulation';
import { SectorRoom } from './sector-room';

export interface MissionRoomDeps {
  /** Secret of this process: only rooms created by the server carry it. */
  readonly creationKey: string;
  readonly tickets: MissionTicketStore;
  readonly expeditions: MissionLifecycle;
  readonly directory: MissionDirectory;
  /** Private seed of each new sector; random unless a test fixes it. */
  readonly sectorSeed?: () => SectorSeed;
  /** Builds the sector from the seed; tests replace it to place things on purpose. */
  readonly generateSector?: (seed: SectorSeed) => SectorDefinition;
}

/** Set by the server when it creates the room; clients cannot create mission rooms. */
export interface MissionRoomOptions {
  readonly expeditionId: string;
  readonly creationKey: string;
}

type MissionClient = Client<{ auth: MissionTicket }>;

/** Wait before trying again an activation the database failed. */
const ACTIVATION_RETRY_MS = 1000;

/** Temporary ID of a loot stack: random, so it says nothing about other containers. */
const lootId = () => `loot_${randomBytes(12).toString('base64url')}`;

/**
 * The match of one expedition. Only its members enter, each with a single-use ticket
 * naming this room; the expedition becomes ACTIVE when the whole roster has loaded
 * before the preparation deadline, otherwise the preparation is cancelled and the
 * room closes. Until extraction and settlement exist (V03.05, V03.07), a match ends
 * when the room closes, as a technical abort that returns the reserved items.
 */
export class MissionRoom extends SectorRoom<MissionTicket> {
  /** Replaced by `defineMissionRoom`. */
  protected deps: MissionRoomDeps | undefined;
  #expeditionId = '';
  /** Nick of each member of the roster, by account. */
  readonly #roster = new Map<string, string>();
  /** Session holding each member's seat (connected or reconnecting). */
  readonly #seats = new Map<string, string>();
  #activating = false;
  #activated = false;
  /** The expedition ended (cancelled or aborted): nothing more to do on dispose. */
  #ended = false;
  #unwatch: (() => void) | null = null;
  /** onCreate finished; before that an end only marks the room (it cannot close yet). */
  #ready = false;
  #closing = false;
  #loot: MissionLoot | null = null;
  /** What each session could reach when its inventory view was last sent. */
  readonly #sentAccess = new Map<string, string>();
  /** Last view sent to each session, to skip sending one that did not change. */
  readonly #sentView = new Map<string, string>();

  /** Refuses everyone unless registered through `defineMissionRoom`. */
  static override async onAuth(
    _token: string,
    _options: unknown,
    _context: AuthContext,
  ): Promise<MissionTicket> {
    throw new ServerError(403, 'invalid_ticket');
  }

  get #deps(): MissionRoomDeps {
    if (!this.deps) throw new Error('MissionRoom sem dependências');
    return this.deps;
  }

  override async onCreate(options: Partial<MissionRoomOptions> | undefined): Promise<void> {
    // A client asking the matchmaker to create a mission room does not know the key.
    if (options?.creationKey !== this.#deps.creationKey || !options.expeditionId) {
      throw new ServerError(403, 'mission_rooms_are_created_by_the_server');
    }
    // Watching starts before the roster is read: a cancellation committed meanwhile
    // is either seen in the roster or delivered to the watcher.
    this.#unwatch = this.#deps.expeditions.watch(options.expeditionId, {
      onCancelled: () => this.#close(MISSION_CANCELLED_CLOSE_CODE),
      onAborted: () => this.#close(MISSION_ENDED_CLOSE_CODE),
    });
    const roster = await this.#deps.expeditions.roster(options.expeditionId);
    if (!roster || roster.state !== 'PREPARING' || this.#ended) {
      this.#unwatch();
      throw new Error('Expedição sem preparação para abrir a sala');
    }
    // Known before anything below can fail: a room that fails to open still cancels
    // the preparation on dispose, returning the items at once.
    this.#expeditionId = roster.expeditionId;
    if (!isShipHullId(roster.shipId)) {
      throw new Error(`Nave desconhecida na expedição: ${roster.shipId}`);
    }
    // The seed stays in this process: clients receive only the resulting geometry.
    const seed = (this.#deps.sectorSeed ?? newSectorSeed)();
    const sector = (this.#deps.generateSector ?? generateOpenSector)(seed);
    this.startSector(new SectorSimulation(sector, roster.shipId));
    this.#loot = new MissionLoot({
      simulation: this.simulation,
      members: roster.members,
      loot: generateContainerLoot(seed, sector.containers),
      newId: lootId,
    });
    this.onMessage(ClientMessage.InventoryTransfer, (client: MissionClient, raw: unknown) =>
      this.#transfer(client, raw),
    );
    for (const member of roster.members) this.#roster.set(member.accountId, member.nick);
    this.maxClients = roster.members.length;
    // Not listed for matchmaking; joining needs this room's ID and a ticket for it.
    await this.setPrivate(true);
    // The deadline, not an empty room, decides when an unstarted match is given up.
    this.autoDispose = false;
    this.#ready = true;
    if (this.#ended) this.#close(MISSION_CANCELLED_CLOSE_CODE);
  }

  override onJoin(client: MissionClient): void {
    const ticket = client.auth;
    if (
      !ticket ||
      ticket.roomId !== this.roomId ||
      ticket.expeditionId !== this.#expeditionId ||
      !this.#roster.has(ticket.accountId)
    ) {
      throw new ServerError(403, 'invalid_ticket');
    }
    if (this.#ended) throw new ServerError(410, 'mission_ended');
    // A second window would duplicate the character; the first one keeps the seat.
    if (this.#seats.has(ticket.accountId)) {
      throw new ServerError(409, 'already_in_mission');
    }
    this.#seats.set(ticket.accountId, client.sessionId);
    this.addCrewMember(client.sessionId, this.#roster.get(ticket.accountId) ?? ticket.nick);
    this.syncState();
    // The first view goes on the next tick (afterStep), once the client listens.
    this.#forgetSent(client.sessionId);
    if (this.#seats.size === this.#roster.size) void this.#activate();
  }

  /**
   * Before the match starts, a dropped loader gives up the seat at once and enters
   * again with a new ticket: holding it for the reconnection window would outlast the
   * preparation deadline and count someone who is not there. After the match starts,
   * the usual reconnection window applies.
   */
  override onDrop(client: MissionClient): void {
    if (this.#activated) super.onDrop(client);
  }

  override onReconnect(client: MissionClient): void {
    super.onReconnect(client);
    // Changes made while away arrive on the next tick.
    this.#forgetSent(client.sessionId);
  }

  override onLeave(client: MissionClient): void {
    super.onLeave(client);
    this.#forgetSent(client.sessionId);
    const accountId = client.auth?.accountId;
    if (accountId && this.#seats.get(accountId) === client.sessionId) this.#seats.delete(accountId);
  }

  override onDispose(): void {
    this.#unwatch?.();
    this.#deps.directory.closed(this.#expeditionId);
    if (this.#ended || !this.#expeditionId) return;
    this.#ended = true;
    const expeditions = this.#deps.expeditions;
    const ending = this.#activated
      ? expeditions.abort(this.#expeditionId)
      : expeditions.cancel(this.#expeditionId, 'room_closed');
    ending.catch((error: unknown) => {
      console.error(`[mission] não foi possível encerrar a expedição: ${errorName(error)}`);
    });
  }

  /** Walking to or away from the hatch, or the hull reaching a container, updates the view. */
  protected override afterStep(): void {
    const loot = this.#loot;
    if (!loot) return;
    for (const client of this.clients as MissionClient[]) {
      if (this.#sentAccess.get(client.sessionId) !== loot.accessKey(client.sessionId)) {
        this.#sendInventory(client);
      }
    }
  }

  #transfer(client: MissionClient, raw: unknown): void {
    const parsed = parseInventoryTransfer(raw);
    if (!parsed.ok) {
      this.rejectInvalid(client, ClientMessage.InventoryTransfer, parsed.code);
      return;
    }
    const accountId = client.auth?.accountId;
    if (!this.#loot || !accountId) return;
    // Nothing changes hands before everyone is aboard and the match is on.
    const refusal = this.#activated
      ? this.#loot.transfer(accountId, client.sessionId, parsed.value)
      : ErrorCode.MatchNotActive;
    if (refusal) {
      this.notifyRefusal(client, ClientMessage.InventoryTransfer, refusal);
      return;
    }
    // The hold and containers are shared: whoever's view changed gets it again.
    for (const member of this.clients as MissionClient[]) this.#sendInventory(member);
  }

  /** Each member receives only their own view (docs/05): never someone else's backpack. */
  #sendInventory(client: MissionClient): void {
    const accountId = client.auth?.accountId;
    if (!this.#loot || !accountId) return;
    this.#sentAccess.set(client.sessionId, this.#loot.accessKey(client.sessionId));
    const view = this.#loot.view(accountId, client.sessionId);
    const serialized = JSON.stringify(view);
    if (this.#sentView.get(client.sessionId) === serialized) return;
    this.#sentView.set(client.sessionId, serialized);
    client.send(ServerMessage.Inventory, view);
  }

  #forgetSent(sessionId: string): void {
    this.#sentAccess.delete(sessionId);
    this.#sentView.delete(sessionId);
  }

  /** Everyone loaded: the match starts if the preparation is still in time. */
  async #activate(): Promise<void> {
    if (this.#activating || this.#activated) return;
    this.#activating = true;
    try {
      const result = await this.#deps.expeditions.activate(this.#expeditionId);
      if (result === 'activated') {
        this.#activated = true;
        this.state.phase = RoomPhase.Active;
        // From now on the match ends when everyone is gone (after reconnection windows).
        this.autoDispose = true;
        return;
      }
      // Too late: the deadline cancels the preparation and returns the items.
      if (result === 'expired') return;
      this.#close(MISSION_CANCELLED_CLOSE_CODE);
    } catch (error) {
      console.error(`[mission] não foi possível ativar a expedição: ${errorName(error)}`);
      // Everyone is aboard and no new join will try again: retry until the deadline.
      this.clock.setTimeout(() => {
        if (this.#seats.size === this.#roster.size) void this.#activate();
      }, ACTIVATION_RETRY_MS);
    } finally {
      this.#activating = false;
    }
  }

  #close(code: number): void {
    this.#ended = true;
    if (!this.#ready || this.#closing) return;
    this.#closing = true;
    void this.disconnect(code);
  }
}

/** Binds the mission room to this server's tickets and expeditions. */
export function defineMissionRoom(deps: MissionRoomDeps): typeof MissionRoom {
  return class ConfiguredMissionRoom extends MissionRoom {
    protected override deps: MissionRoomDeps | undefined = deps;

    static override async onAuth(
      token: string,
      _options: unknown,
      _context: AuthContext,
    ): Promise<MissionTicket> {
      const ticket = deps.tickets.consume(token);
      if (!ticket) throw new ServerError(403, 'invalid_ticket');
      return ticket;
    }
  };
}
