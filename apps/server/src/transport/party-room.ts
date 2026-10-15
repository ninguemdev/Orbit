import { type AuthContext, type Client, Room, ServerError } from '@colyseus/core';
import {
  PARTY_INVITE_TTL_SECONDS,
  PARTY_KICKED_CLOSE_CODE,
  PARTY_MAX_MEMBERS,
  PARTY_MOVED_CLOSE_CODE,
  PARTY_RECONNECTION_SECONDS,
  PartyClientMessage,
  PartyErrorCode,
  type PartyInviteNotice,
  type PartyRefusal,
  PartyServerMessage,
  partyInviteSchema,
  partyMemberTargetSchema,
  partyConfirmSchema,
  partySelectClassSchema,
  partySelectShipSchema,
  partySetReadySchema,
} from '@orbit/contracts';
import { isClassId, isShipHullId } from '@orbit/catalog';
import type { PartyDirectory, PartyRoomHandle } from '../modules/party/party-directory';
import type { RoomTicket, RoomTicketStore } from '../modules/party/room-tickets';
import { PartyMemberState, PartyState } from './party-schema';

/** Remembers each account's class choice beyond the party (the profile in the database). */
export interface ClassPreferences {
  save(accountId: string, classId: string): Promise<void>;
}

/** Saved loadout of an account, checked against its saved class (the database). */
export interface LoadoutReader {
  loadout(accountId: string): Promise<readonly PreparedItem[]>;
}

export interface PreparedItem {
  readonly slot: string;
  readonly instanceId: string;
  readonly issue: string | null;
}

/** What the leader confirmed: the roster of one revision, kept for the mission (0.3). */
export interface PreparationProposal {
  readonly revision: number;
  readonly shipId: string;
  readonly members: readonly {
    readonly accountId: string;
    readonly classId: string;
    readonly loadout: readonly PreparedItem[];
  }[];
}

export interface PartyRoomDeps {
  readonly tickets: RoomTicketStore;
  readonly directory: PartyDirectory;
  readonly classPreferences?: ClassPreferences;
  /** Without it (tests without a database) every loadout counts as empty and valid. */
  readonly loadouts?: LoadoutReader;
  readonly now?: () => number;
}

type PartyClient = Client<{ auth: RoomTicket }>;

/**
 * A party: up to four accounts preparing together. Entry requires a single-use
 * ticket issued to an authenticated session; the leader manages members.
 */
export class PartyRoom
  extends Room<{ state: PartyState; client: PartyClient }>
  implements PartyRoomHandle
{
  override maxClients = PARTY_MAX_MEMBERS;
  override maxMessagesPerSecond = 20;
  override state = new PartyState();

  /** Replaced by `definePartyRoom`. */
  protected deps: PartyRoomDeps | undefined;
  inviteCode = '';
  readonly #clients = new Map<string, PartyClient>();
  /** Members removed on purpose (kicked or moved): their drop gets no reconnection. */
  readonly #removed = new Set<string>();
  /** Removed by the leader: the invite code no longer admits them, a new invite does. */
  readonly #kicked = new Set<string>();

  /** Refuses everyone unless registered through `definePartyRoom`. */
  static override async onAuth(
    _token: string,
    _options: unknown,
    _context: AuthContext,
  ): Promise<RoomTicket> {
    throw new ServerError(403, 'invalid_ticket');
  }

  get #deps(): PartyRoomDeps {
    if (!this.deps) throw new Error('PartyRoom sem dependências');
    return this.deps;
  }

  override onCreate(): void {
    this.inviteCode = this.#deps.directory.newInviteCode();
    this.state.inviteCode = this.inviteCode;
    this.#deps.directory.register(this);
    void this.setPrivate(true);

    this.onMessage(PartyClientMessage.Invite, (client: PartyClient, raw: unknown) => {
      const parsed = partyInviteSchema.safeParse(raw);
      if (!parsed.success)
        return this.#refuse(client, PartyClientMessage.Invite, PartyErrorCode.InvalidPayload);
      this.#invite(client, parsed.data.nick);
    });
    this.onMessage(PartyClientMessage.Kick, (client: PartyClient, raw: unknown) => {
      const parsed = partyMemberTargetSchema.safeParse(raw);
      if (!parsed.success)
        return this.#refuse(client, PartyClientMessage.Kick, PartyErrorCode.InvalidPayload);
      this.#kick(client, parsed.data.accountId);
    });
    this.onMessage(PartyClientMessage.Promote, (client: PartyClient, raw: unknown) => {
      const parsed = partyMemberTargetSchema.safeParse(raw);
      if (!parsed.success)
        return this.#refuse(client, PartyClientMessage.Promote, PartyErrorCode.InvalidPayload);
      this.#promote(client, parsed.data.accountId);
    });
    this.onMessage(PartyClientMessage.SelectClass, (client: PartyClient, raw: unknown) => {
      const action = PartyClientMessage.SelectClass;
      const parsed = partySelectClassSchema.safeParse(raw);
      if (!parsed.success) return this.#refuse(client, action, PartyErrorCode.InvalidPayload);
      const { classId } = parsed.data;
      if (!isClassId(classId)) return this.#refuse(client, action, PartyErrorCode.UnknownClass);
      const accountId = client.auth?.accountId;
      const member = accountId ? this.state.members.get(accountId) : undefined;
      if (!accountId || !member || this.#clients.get(accountId) !== client) {
        return this.#refuse(client, action, PartyErrorCode.NotMember);
      }
      // Each member chooses their own class; repeated classes are allowed.
      const preferences = this.#deps.classPreferences;
      if (!preferences) {
        if (member.classId !== classId) this.#changed();
        member.classId = classId;
        return;
      }
      // The class is shown only after the account remembers it, so every server check
      // of the class (loadout, readiness) agrees with what the party displays. Saves of
      // one account run in order, so the last choice wins.
      const previous = this.#classSaves.get(accountId) ?? Promise.resolve();
      const next = previous.then(async () => {
        try {
          await preferences.save(accountId, classId);
        } catch (error) {
          const name = error instanceof Error ? error.name : typeof error;
          console.error(`[party] não foi possível salvar a classe: ${name}`);
          this.#refuse(client, action, PartyErrorCode.ClassNotSaved);
          return;
        }
        const current = this.state.members.get(accountId);
        if (current && current.classId !== classId) {
          current.classId = classId;
          this.#changed();
        }
      });
      this.#classSaves.set(accountId, next);
      void next.finally(() => {
        if (this.#classSaves.get(accountId) === next) this.#classSaves.delete(accountId);
      });
    });
    this.onMessage(PartyClientMessage.SelectShip, (client: PartyClient, raw: unknown) => {
      const action = PartyClientMessage.SelectShip;
      const parsed = partySelectShipSchema.safeParse(raw);
      if (!parsed.success) return this.#refuse(client, action, PartyErrorCode.InvalidPayload);
      if (!this.#isLeader(client)) return this.#refuse(client, action, PartyErrorCode.NotLeader);
      // Any current member's license makes the ship available to the whole party.
      if (!this.#availableShips().has(parsed.data.shipId)) {
        return this.#refuse(client, action, PartyErrorCode.ShipUnavailable);
      }
      if (this.state.selectedShipId === parsed.data.shipId) return;
      this.state.selectedShipId = parsed.data.shipId;
      this.#changed();
    });
    this.onMessage(PartyClientMessage.SetReady, (client: PartyClient, raw: unknown) => {
      const parsed = partySetReadySchema.safeParse(raw);
      if (!parsed.success) {
        return this.#refuse(client, PartyClientMessage.SetReady, PartyErrorCode.InvalidPayload);
      }
      void this.#setReady(client, parsed.data.revision, parsed.data.ready);
    });
    this.onMessage(PartyClientMessage.Confirm, (client: PartyClient, raw: unknown) => {
      const parsed = partyConfirmSchema.safeParse(raw);
      if (!parsed.success) {
        return this.#refuse(client, PartyClientMessage.Confirm, PartyErrorCode.InvalidPayload);
      }
      void this.#confirm(client, parsed.data.revision);
    });
    this.onMessage('*', (client: PartyClient, type) => {
      this.#refuse(client, String(type), PartyErrorCode.InvalidPayload);
    });
  }

  override onJoin(client: PartyClient): void {
    const ticket = client.auth;
    if (!ticket) throw new ServerError(403, 'invalid_ticket');
    const { intent, accountId, nick } = ticket;
    if (intent.kind === 'join' && intent.roomId !== this.roomId) {
      throw new ServerError(403, 'invalid_ticket');
    }
    if (intent.kind === 'create' && this.state.members.size > 0) {
      throw new ServerError(403, 'invalid_ticket');
    }
    if (this.state.members.has(accountId)) throw new ServerError(409, PartyErrorCode.AlreadyMember);
    if (this.#kicked.has(accountId) && intent.kind === 'join' && !intent.invited) {
      throw new ServerError(403, 'removed_from_party');
    }
    this.#kicked.delete(accountId);

    const member = new PartyMemberState();
    member.accountId = accountId;
    member.nick = nick;
    member.connected = true;
    member.joinedAt = this.#now();
    member.classId = isClassId(ticket.classId) ? ticket.classId : '';
    // Licenses as read when the ticket was issued (already in catalog order); IDs the
    // catalog does not know cannot be chosen, so they are left out.
    for (const shipId of ticket.ships) if (isShipHullId(shipId)) member.ships.push(shipId);
    const creator = this.state.members.size === 0;
    this.state.members.set(accountId, member);
    if (!this.state.leaderId) this.state.leaderId = accountId;
    // A new party starts with its creator's first ship in catalog order. Later
    // arrivals never choose: an empty choice waits for the leader.
    if (creator) this.state.selectedShipId = member.ships.at(0) ?? '';
    this.#clients.set(accountId, client);
    this.#removed.delete(accountId);
    this.#deps.directory.joined(accountId, nick, this.roomId);
    this.#changed();
  }

  override onDrop(client: PartyClient): void {
    const accountId = client.auth?.accountId;
    // Also called for a connection whose join was refused; it never became a member.
    if (!accountId || this.#clients.get(accountId) !== client) return;
    const member = this.state.members.get(accountId);
    if (member) member.connected = false;
    // A dropped member cannot confirm anything: readiness starts over.
    this.#changed();
    if (!this.#removed.has(accountId)) {
      // Rejects when the client dropped before finishing the join handshake or when the
      // seat expires; Colyseus then calls onLeave. Unhandled, it would end the process.
      this.allowReconnection(client, PARTY_RECONNECTION_SECONDS).catch(() => undefined);
    }
  }

  override onReconnect(client: PartyClient): void {
    const accountId = client.auth?.accountId;
    const member = accountId ? this.state.members.get(accountId) : undefined;
    if (!accountId || !member) {
      // Removed while disconnected (kicked, or joined another party): the seat was
      // still reserved, but the member is gone.
      const kicked = accountId !== undefined && this.#kicked.has(accountId);
      client.leave(kicked ? PARTY_KICKED_CLOSE_CODE : PARTY_MOVED_CLOSE_CODE);
      return;
    }
    member.connected = true;
    this.#clients.set(accountId, client);
  }

  override onLeave(client: PartyClient): void {
    const accountId = client.auth?.accountId;
    // A refused join (e.g. the same account in a second tab) must not remove the
    // member connected through another client.
    if (!accountId || this.#clients.get(accountId) !== client) return;
    this.#clients.delete(accountId);
    this.#removeMember(accountId);
  }

  override onDispose(): void {
    this.#deps.directory.unregister(this);
  }

  // PartyRoomHandle ------------------------------------------------------------

  memberCount(): number {
    return this.state.members.size;
  }

  hasMember(accountId: string): boolean {
    return this.state.members.has(accountId);
  }

  refusesAccount(accountId: string): boolean {
    return this.#kicked.has(accountId);
  }

  notifyInvite(accountId: string, notice: PartyInviteNotice): boolean {
    const client = this.#clients.get(accountId);
    // A member in the reconnection window cannot see it now.
    if (!client || !this.state.members.get(accountId)?.connected) return false;
    client.send(PartyServerMessage.InviteReceived, notice);
    return true;
  }

  evict(accountId: string): void {
    this.#removeOnPurpose(accountId, PARTY_MOVED_CLOSE_CODE, 'moved_to_another_party');
  }

  preparationChanged(accountId: string): void {
    if (this.state.members.has(accountId)) this.#changed();
  }

  /** The confirmed proposal of the current revision, if any. */
  get proposal(): PreparationProposal | null {
    return this.#proposal;
  }

  // Rules ------------------------------------------------------------------------

  #invite(client: PartyClient, nick: string): void {
    const action = PartyClientMessage.Invite;
    if (!this.#isLeader(client)) return this.#refuse(client, action, PartyErrorCode.NotLeader);
    if (this.state.members.size >= PARTY_MAX_MEMBERS) {
      return this.#refuse(client, action, PartyErrorCode.PartyFull);
    }
    const target = this.#deps.directory.findOnline(nick);
    if (!target) return this.#refuse(client, action, PartyErrorCode.PlayerOffline);
    if (this.state.members.has(target.accountId)) {
      return this.#refuse(client, action, PartyErrorCode.AlreadyMember);
    }
    // A new invite is the way back for a removed member.
    this.#kicked.delete(target.accountId);
    const invite = this.#deps.directory.createInvite(
      this.roomId,
      target.accountId,
      client.auth?.nick ?? '',
    );
    const delivered = this.#deps.directory.room(target.roomId)?.notifyInvite(target.accountId, {
      inviteId: invite.id,
      fromNick: client.auth?.nick ?? '',
      memberCount: this.state.members.size,
      expiresInSeconds: PARTY_INVITE_TTL_SECONDS,
    });
    if (!delivered) this.#refuse(client, action, PartyErrorCode.PlayerOffline);
  }

  #kick(client: PartyClient, targetId: string): void {
    const action = PartyClientMessage.Kick;
    if (!this.#isLeader(client)) return this.#refuse(client, action, PartyErrorCode.NotLeader);
    if (targetId === client.auth?.accountId || !this.state.members.has(targetId)) {
      return this.#refuse(client, action, PartyErrorCode.NotMember);
    }
    this.#kicked.add(targetId);
    this.#removeOnPurpose(targetId, PARTY_KICKED_CLOSE_CODE, 'kicked_by_leader');
  }

  /**
   * Removes a member now. A connected one is disconnected with `code`; a dropped one
   * is taken off the list at once (closing their dead socket would do nothing), and a
   * later reconnection is turned away in onReconnect.
   */
  #removeOnPurpose(accountId: string, code: number, reason: string): void {
    this.#removed.add(accountId);
    const member = this.state.members.get(accountId);
    const client = this.#clients.get(accountId);
    if (client && member?.connected) {
      client.leave(code, reason);
      return;
    }
    this.#removeMember(accountId);
  }

  #promote(client: PartyClient, targetId: string): void {
    const action = PartyClientMessage.Promote;
    if (!this.#isLeader(client)) return this.#refuse(client, action, PartyErrorCode.NotLeader);
    if (!this.state.members.has(targetId))
      return this.#refuse(client, action, PartyErrorCode.NotMember);
    this.state.leaderId = targetId;
  }

  #removeMember(accountId: string): void {
    if (!this.state.members.delete(accountId)) return;
    this.#changed();
    this.#deps.directory.left(accountId, this.roomId);
    if (this.state.leaderId === accountId) this.state.leaderId = this.#nextLeader();
    // The last owner of the selected ship left: the choice is no longer valid.
    if (this.state.selectedShipId && !this.#availableShips().has(this.state.selectedShipId)) {
      this.state.selectedShipId = '';
    }
  }

  /** Union of the members' ship licenses, without duplicates. */
  #availableShips(): Set<string> {
    const ships = new Set<string>();
    this.state.members.forEach((member) => member.ships.forEach((shipId) => ships.add(shipId)));
    return ships;
  }

  /** The longest-standing member leads; connected members are preferred. */
  #nextLeader(): string {
    const members = [...this.state.members.values()].sort((a, b) => a.joinedAt - b.joinedAt);
    return (members.find((member) => member.connected) ?? members[0])?.accountId ?? '';
  }

  #isLeader(client: PartyClient): boolean {
    return client.auth?.accountId === this.state.leaderId;
  }

  /** Pending class saves per account, chained so they finish in order. */
  readonly #classSaves = new Map<string, Promise<void>>();
  #proposal: PreparationProposal | null = null;
  /** Latest readiness request per member; older answers are dropped. */
  readonly #readyRequests = new Map<string, number>();

  #logFailure(what: string, error: unknown): void {
    const name = error instanceof Error ? error.name : typeof error;
    console.error(`[party] não foi possível ${what}: ${name}`);
  }

  // Preparation -----------------------------------------------------------------

  /**
   * A change that matters for the mission: a new revision, nobody ready, and no
   * confirmation. Requests naming the previous revision will fail.
   */
  #changed(): void {
    this.state.revision += 1;
    this.state.confirmedRevision = 0;
    this.#proposal = null;
    this.state.members.forEach((member) => {
      member.ready = false;
    });
  }

  /** Problems that keep a member from being ready, read from the saved loadout. */
  async #loadoutOf(accountId: string): Promise<readonly PreparedItem[]> {
    return (await this.#deps.loadouts?.loadout(accountId)) ?? [];
  }

  async #setReady(client: PartyClient, revision: number, ready: boolean): Promise<void> {
    const action = PartyClientMessage.SetReady;
    const accountId = client.auth?.accountId;
    const member = accountId ? this.state.members.get(accountId) : undefined;
    if (!accountId || !member || this.#clients.get(accountId) !== client) {
      return this.#refuse(client, action, PartyErrorCode.NotMember);
    }
    if (revision !== this.state.revision) {
      return this.#refuse(client, action, PartyErrorCode.StaleRevision);
    }
    // Only the member's latest request counts, even if an earlier one finishes later.
    const request = (this.#readyRequests.get(accountId) ?? 0) + 1;
    this.#readyRequests.set(accountId, request);
    if (!ready) {
      member.ready = false;
      // A confirmation needs everyone ready; it no longer holds.
      this.state.confirmedRevision = 0;
      this.#proposal = null;
      return;
    }
    if (!member.classId) return this.#refuse(client, action, PartyErrorCode.ClassMissing);
    if (member.ready) return;
    let loadout: readonly PreparedItem[];
    try {
      loadout = await this.#loadoutOf(accountId);
    } catch (error) {
      this.#logFailure('ler o loadout', error);
      return this.#refuse(client, action, PartyErrorCode.PreparationUnavailable);
    }
    // A later request from the same member replaced this one.
    if (this.#readyRequests.get(accountId) !== request) return;
    // Anything may have changed while the loadout was read.
    if (revision !== this.state.revision || this.state.members.get(accountId) !== member) {
      return this.#refuse(client, action, PartyErrorCode.StaleRevision);
    }
    if (loadout.some((item) => item.issue !== null)) {
      return this.#refuse(client, action, PartyErrorCode.LoadoutInvalid);
    }
    member.ready = true;
  }

  async #confirm(client: PartyClient, revision: number): Promise<void> {
    const action = PartyClientMessage.Confirm;
    if (!this.#isLeader(client)) return this.#refuse(client, action, PartyErrorCode.NotLeader);
    if (revision !== this.state.revision) {
      return this.#refuse(client, action, PartyErrorCode.StaleRevision);
    }
    const shipId = this.state.selectedShipId;
    if (!shipId) return this.#refuse(client, action, PartyErrorCode.ShipMissing);
    const members = [...this.state.members.values()];
    if (members.some((member) => !member.ready || !member.connected)) {
      return this.#refuse(client, action, PartyErrorCode.MembersNotReady);
    }
    // The loadouts are read again: the proposal records exactly what each member takes.
    let loadouts: (readonly PreparedItem[])[];
    try {
      loadouts = await Promise.all(members.map((member) => this.#loadoutOf(member.accountId)));
    } catch (error) {
      this.#logFailure('ler os loadouts', error);
      return this.#refuse(client, action, PartyErrorCode.PreparationUnavailable);
    }
    // Everything checked before the read is checked again: leadership may have passed,
    // someone may have stopped being ready (which keeps the revision), or left.
    if (revision !== this.state.revision) {
      return this.#refuse(client, action, PartyErrorCode.StaleRevision);
    }
    if (!this.#isLeader(client)) return this.#refuse(client, action, PartyErrorCode.NotLeader);
    const now = [...this.state.members.values()];
    const sameRoster =
      now.length === members.length && now.every((member, index) => member === members[index]);
    if (!sameRoster) return this.#refuse(client, action, PartyErrorCode.StaleRevision);
    if (now.some((member) => !member.ready || !member.connected)) {
      return this.#refuse(client, action, PartyErrorCode.MembersNotReady);
    }
    if (loadouts.some((loadout) => loadout.some((item) => item.issue !== null))) {
      return this.#refuse(client, action, PartyErrorCode.LoadoutInvalid);
    }
    this.#proposal = {
      revision,
      shipId,
      members: members.map((member, index) => ({
        accountId: member.accountId,
        classId: member.classId,
        loadout: loadouts[index] ?? [],
      })),
    };
    this.state.confirmedRevision = revision;
  }

  #refuse(client: PartyClient, action: string, code: PartyErrorCode): void {
    const refusal: PartyRefusal = { action, code };
    client.send(PartyServerMessage.Refused, refusal);
  }

  #now(): number {
    return (this.#deps.now ?? Date.now)();
  }
}

/** Binds the party room to this server's ticket store and directory. */
export function definePartyRoom(deps: PartyRoomDeps): typeof PartyRoom {
  return class ConfiguredPartyRoom extends PartyRoom {
    protected override deps: PartyRoomDeps | undefined = deps;

    static override async onAuth(
      token: string,
      _options: unknown,
      _context: AuthContext,
    ): Promise<RoomTicket> {
      const ticket = deps.tickets.consume(token);
      if (!ticket) throw new ServerError(403, 'invalid_ticket');
      return ticket;
    }
  };
}
