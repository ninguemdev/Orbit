import { type Client, Room } from '@colyseus/core';
import { CATALOG_VERSION, type SectorFeature } from '@orbit/catalog';
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
  parseCrewInput,
  parseEmptyPayload,
  parseShipInput,
} from '@orbit/contracts';
import { SectorSimulation } from '../simulation/sector-simulation';
import {
  AsteroidState,
  CrewMemberState,
  SectorFeatureState,
  SectorLayoutState,
  SectorState,
  ShipState,
} from './sector-schema';
import { ViolationBudget } from './violation-budget';

/** Hard cap; above it Colyseus drops the connection. Normal play sends ~20–40/s. */
const MAX_MESSAGES_PER_SECOND = 60;
/** Invalid messages tolerated per window before the connection is closed. */
const MAX_VIOLATIONS = 20;
const VIOLATION_WINDOW_MS = 10_000;
/** Close code for connections dropped for sending invalid messages repeatedly. */
export const ABUSE_CLOSE_CODE = 4409;

/**
 * A sector with one ship and its crew: validates and forwards intents, manages
 * connections and drives the fixed 20 Hz step. Game rules live in SectorSimulation.
 * Rooms differ in who may enter (`TAuth`) and when the match is active.
 */
export abstract class SectorRoom<TAuth> extends Room<{
  state: SectorState;
  client: Client<{ auth: TAuth }>;
}> {
  override maxClients = MAX_CREW;
  override patchRate = 1000 / TICK_RATE_HZ;
  override maxMessagesPerSecond = MAX_MESSAGES_PER_SECOND;
  override state = new SectorState();

  /** Set by `startSector`, before any client joins. */
  protected simulation!: SectorSimulation;
  protected now: () => number = () => performance.now();
  readonly #violations = new Map<string, ViolationBudget>();
  readonly #abusive = new Set<string>();

  /** The fixed development sector; mission rooms generate their own sector instead. */
  override onCreate(_options?: unknown): void {
    this.startSector(new SectorSimulation());
  }

  /** Publishes the sector's geometry and starts the fixed step. Called once, from onCreate. */
  protected startSector(simulation: SectorSimulation): void {
    this.simulation = simulation;
    this.state.protocolVersion = PROTOCOL_VERSION;
    this.state.catalogVersion = CATALOG_VERSION;
    this.state.sectorId = this.simulation.sector.id;
    this.state.phase = RoomPhase.Preparing;
    this.state.ship = new ShipState();
    this.state.ship.hullId = this.simulation.ship.hull.id;
    this.state.ship.maxHullPoints = this.simulation.ship.hull.maxHull;
    this.state.layout = layoutState(this.simulation);
    this.syncState();
    this.setFixedTimestep((ctx) => {
      this.simulation.step(ctx.dt, this.now());
      this.syncState();
      this.afterStep();
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
    this.onMessage(ClientMessage.RequestExtraction, (client, raw: unknown) => {
      const parsed = parseEmptyPayload(raw);
      if (!parsed.ok) {
        return this.rejectInvalid(client, ClientMessage.RequestExtraction, parsed.code);
      }
      const result = this.simulation.requestExtraction(client.sessionId, this.now());
      if (!result.ok) this.notifyRefusal(client, ClientMessage.RequestExtraction, result.code);
      this.syncState();
    });
    this.onMessage('*', (client, type) => {
      this.rejectInvalid(client, String(type), ErrorCode.InvalidPayload);
    });
  }

  /** Runs after every fixed step, once the state is synchronized. */
  protected afterStep(): void {}

  /** Puts a crew member aboard the ship and in the synchronized state. */
  protected addCrewMember(sessionId: string, name: string): void {
    const member = this.simulation.addCrew(sessionId, name);
    const view = new CrewMemberState();
    view.id = member.id;
    view.name = member.name;
    view.colorIndex = member.colorIndex;
    this.state.crew.set(sessionId, view);
  }

  override onDrop(client: Client): void {
    this.simulation.setConnected(client.sessionId, false);
    this.syncState();
    // Abusive connections are not offered a seat back; onLeave follows.
    if (!this.#abusive.has(client.sessionId)) {
      // Rejects when the client dropped before finishing the join handshake or when the
      // seat expires; Colyseus then calls onLeave. Unhandled, it would end the process.
      this.allowReconnection(client, RECONNECTION_WINDOW_SECONDS).catch(() => undefined);
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
    state.ship.hullPoints = simulation.ship.hullPoints;
    state.missionOutcome = simulation.outcome;
    state.evacuationCounting = simulation.evacuation.counting;
    state.evacuationSecondsLeft = simulation.evacuation.counting
      ? Math.max(0, Math.ceil((simulation.evacuation.deadlineMs - this.now()) / 1000))
      : 0;
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

/** Static geometry sent once to clients: what is visible, never how it was generated. */
function layoutState(simulation: SectorSimulation): SectorLayoutState {
  const { bounds, obstacles, containers, extractionZones } = simulation.sector;
  const layout = new SectorLayoutState();
  layout.minX = bounds.minX;
  layout.minY = bounds.minY;
  layout.maxX = bounds.maxX;
  layout.maxY = bounds.maxY;
  for (const { x, y, radius } of obstacles) {
    const asteroid = new AsteroidState();
    Object.assign(asteroid, { x, y, radius });
    layout.asteroids.push(asteroid);
  }
  const feature = ({ id, x, y, radius }: SectorFeature) => {
    const view = new SectorFeatureState();
    Object.assign(view, { id, x, y, radius });
    return view;
  };
  for (const container of containers) layout.containers.push(feature(container));
  for (const zone of extractionZones) layout.extractionZones.push(feature(zone));
  return layout;
}
