import { type AuthContext, type Client, Room, ServerError } from '@colyseus/core';
import { CATALOG_VERSION } from '@orbit/catalog';
import {
  MAX_CREW,
  PROTOCOL_VERSION,
  RECONNECTION_WINDOW_SECONDS,
  RoomPhase,
  TICK_RATE_HZ,
  type JoinOptions,
} from '@orbit/contracts';
import { SectorSimulation } from '../simulation/sector-simulation';
import { type AccessPolicy, decideJoin } from './access-policy';
import { CrewMemberState, SectorState, ShipState } from './sector-schema';

export interface DevSectorAuth {
  readonly options: JoinOptions;
}

/** Hard cap; above it Colyseus drops the connection. Normal play sends ~20–40/s. */
const MAX_MESSAGES_PER_SECOND = 60;

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
  }

  override onJoin(client: Client<{ auth: DevSectorAuth }>): void {
    const index = this.simulation.crew.size + 1;
    const name = client.auth?.options.name ?? `Tripulante_${index}`;
    const member = this.simulation.addCrew(client.sessionId, name);
    const view = new CrewMemberState();
    view.id = member.id;
    view.name = member.name;
    view.colorIndex = member.colorIndex;
    view.lastInputSeq = -1;
    this.state.crew.set(client.sessionId, view);
    this.state.phase = RoomPhase.Active;
    this.syncState();
  }

  override onDrop(client: Client): void {
    this.simulation.setConnected(client.sessionId, false);
    this.syncState();
    this.allowReconnection(client, RECONNECTION_WINDOW_SECONDS);
  }

  override onReconnect(client: Client): void {
    this.simulation.setConnected(client.sessionId, true);
    this.syncState();
  }

  override onLeave(client: Client): void {
    this.simulation.removeCrew(client.sessionId);
    this.state.crew.delete(client.sessionId);
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
    for (const member of simulation.crew.values()) {
      const view = state.crew.get(member.id);
      if (!view) continue;
      view.x = member.position.x;
      view.y = member.position.y;
      view.connected = member.connected;
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
