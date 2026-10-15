import { type AuthContext, type Client, Room, ServerError } from '@colyseus/core';
import { CATALOG_VERSION } from '@orbit/catalog';
import {
  type ActionRejectedPayload,
  ClientMessage,
  ErrorCode,
  MAX_CREW,
  PROTOCOL_VERSION,
  RECONNECTION_WINDOW_SECONDS,
  RoomPhase,
  ServerMessage,
  TICK_RATE_HZ,
  type JoinOptions,
  parseCrewInput,
  parseEmptyPayload,
  parseShipInput,
} from '@orbit/contracts';
import { SectorSimulation } from '../simulation/sector-simulation';
import { type AccessPolicy, decideJoin } from './access-policy';
import { CrewMemberState, SectorState, ShipState } from './sector-schema';
import { ViolationBudget } from './violation-budget';

export interface DevSectorAuth {
  readonly options: JoinOptions;
}

/** Hard cap; above it Colyseus drops the connection. Normal play sends ~20–40/s. */
const MAX_MESSAGES_PER_SECOND = 60;
/** Invalid messages tolerated per window before the connection is closed. */
const MAX_VIOLATIONS = 20;
const VIOLATION_WINDOW_MS = 10_000;
/** Close code for connections dropped for sending invalid messages repeatedly. */
export const ABUSE_CLOSE_CODE = 4409;

/**
 * Development sector room: validates and forwards intents, manages connections and
 * drives the fixed 20 Hz step. Game rules live in SectorSimulation.
 */
export class DevSectorRoom extends Room<{
  state: SectorState;
  client: Client<{ auth: DevSectorAuth }>;
}> {
  override maxClients = MAX_CREW;
  override patchRate = 1000 / TICK_RATE_HZ;
  override maxMessagesPerSecond = MAX_MESSAGES_PER_SECOND;
  override state = new SectorState();

  protected readonly simulation = new SectorSimulation();
  protected now: () => number = () => performance.now();
  readonly #violations = new Map<string, ViolationBudget>();
  readonly #abusive = new Set<string>();
  #joinCount = 0;

  /** Denies everyone unless registered through `defineDevSectorRoom` with a policy. */
  static override async onAuth(
    _token: string,
    options: unknown,
    context: AuthContext,
  ): Promise<DevSectorAuth> {
    return authorizeJoin(
      { allowedOrigins: new Set(), allowMissingOrigin: false },
      options,
      context,
    );
  }

  override onCreate(): void {
    this.state.protocolVersion = PROTOCOL_VERSION;
    this.state.catalogVersion = CATALOG_VERSION;
    this.state.sectorId = this.simulation.sector.id;
    this.state.phase = RoomPhase.Preparing;
    this.state.ship = new ShipState();
    this.state.ship.hullId = this.simulation.ship.hull.id;
    this.syncState();
    this.setFixedTimestep((ctx) => {
      this.simulation.step(ctx.dt, this.now());
      this.syncState();
    }, TICK_RATE_HZ);

    this.onMessage(ClientMessage.CrewInput, (client, raw: unknown) => {
      const parsed = parseCrewInput(raw);
      if (!parsed.ok) return this.rejectInvalid(client, ClientMessage.CrewInput, parsed.code);
      // Duplicates and reordering are dropped silently: they are normal on reconnection.
      this.simulation.offerCrewInput(client.sessionId, parsed.value, this.now());
    });
    this.onMessage(ClientMessage.ShipInput, (client, raw: unknown) => {
      const parsed = parseShipInput(raw);
      if (!parsed.ok) return this.rejectInvalid(client, ClientMessage.ShipInput, parsed.code);
      // Inputs still in flight after losing the helm are expected and simply ignored.
      this.simulation.offerShipInput(client.sessionId, parsed.value, this.now());
    });
    this.onMessage(ClientMessage.HelmRequest, (client, raw: unknown) => {
      const parsed = parseEmptyPayload(raw);
      if (!parsed.ok) return this.rejectInvalid(client, ClientMessage.HelmRequest, parsed.code);
      const result = this.simulation.requestHelm(client.sessionId);
      if (!result.ok) this.notifyRefusal(client, ClientMessage.HelmRequest, result.code);
      this.syncState();
    });
    this.onMessage(ClientMessage.HelmRelease, (client, raw: unknown) => {
      const parsed = parseEmptyPayload(raw);
      if (!parsed.ok) return this.rejectInvalid(client, ClientMessage.HelmRelease, parsed.code);
      const result = this.simulation.releaseHelm(client.sessionId);
      if (!result.ok) this.notifyRefusal(client, ClientMessage.HelmRelease, result.code);
      this.syncState();
    });
    this.onMessage('*', (client, type) => {
      this.rejectInvalid(client, String(type), ErrorCode.InvalidPayload);
    });
  }

  override onJoin(client: Client<{ auth: DevSectorAuth }>): void {
    this.#joinCount++;
    const name = client.auth?.options.name ?? `Tripulante_${this.#joinCount}`;
    const member = this.simulation.addCrew(client.sessionId, name);
    const view = new CrewMemberState();
    view.id = member.id;
    view.name = member.name;
    view.colorIndex = member.colorIndex;
    this.state.crew.set(client.sessionId, view);
    this.state.phase = RoomPhase.Active;
    this.syncState();
  }

  override onDrop(client: Client): void {
    this.simulation.setConnected(client.sessionId, false);
    this.syncState();
    // Abusive connections are not offered a seat back; onLeave follows.
    if (!this.#abusive.has(client.sessionId)) {
      this.allowReconnection(client, RECONNECTION_WINDOW_SECONDS);
    }
  }

  override onReconnect(client: Client): void {
    this.simulation.setConnected(client.sessionId, true);
    this.syncState();
  }

  override onLeave(client: Client): void {
    this.simulation.removeCrew(client.sessionId);
    this.state.crew.delete(client.sessionId);
    this.#violations.delete(client.sessionId);
    this.#abusive.delete(client.sessionId);
  }

  /** Tells the player why a valid request was refused (helm taken, too far…). */
  protected notifyRefusal(client: Client, action: string, code: ErrorCode): void {
    const payload: ActionRejectedPayload = { action, code };
    client.send(ServerMessage.ActionRejected, payload);
  }

  /** Answers a malformed message and disconnects clients that keep sending them. */
  protected rejectInvalid(client: Client, action: string, code: ErrorCode): void {
    this.notifyRefusal(client, action, code);
    let budget = this.#violations.get(client.sessionId);
    if (!budget) {
      budget = new ViolationBudget(MAX_VIOLATIONS, VIOLATION_WINDOW_MS);
      this.#violations.set(client.sessionId, budget);
    }
    if (budget.record(this.now()) && !this.#abusive.has(client.sessionId)) {
      this.#abusive.add(client.sessionId);
      client.leave(ABUSE_CLOSE_CODE, 'too_many_invalid_messages');
    }
  }

  /** Copies the authoritative simulation into the synchronized schema. */
  protected syncState(): void {
    const { simulation, state } = this;
    state.tick = simulation.tick;
    const kinematics = simulation.ship.kinematics;
    state.ship.x = kinematics.position.x;
    state.ship.y = kinematics.position.y;
    state.ship.angle = kinematics.angle;
    state.ship.vx = kinematics.velocity.x;
    state.ship.vy = kinematics.velocity.y;
    state.ship.operatorId = simulation.ship.operatorId ?? '';
    for (const member of simulation.crew.values()) {
      const view = state.crew.get(member.id);
      if (!view) continue;
      view.x = member.position.x;
      view.y = member.position.y;
      view.connected = member.connected;
      view.lastInputSeq = member.lastAppliedSeq;
      view.atHelm = member.atHelm;
    }
  }
}

function authorizeJoin(
  policy: AccessPolicy,
  options: unknown,
  context: AuthContext,
): DevSectorAuth {
  const decision = decideJoin(policy, context.headers.get('origin'), options);
  if (!decision.ok) throw new ServerError(403, decision.code);
  return { options: decision.options };
}

/** Binds the room class to this server's access policy. Colyseus calls `onAuth` unbound. */
export function defineDevSectorRoom(policy: AccessPolicy): typeof DevSectorRoom {
  return class ConfiguredDevSectorRoom extends DevSectorRoom {
    static override async onAuth(
      _token: string,
      options: unknown,
      context: AuthContext,
    ): Promise<DevSectorAuth> {
      return authorizeJoin(policy, options, context);
    }
  };
}
