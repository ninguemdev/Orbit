import {
  CREW,
  SECTORS,
  SHIP_HULLS,
  SectorId,
  ShipHullId,
  type SectorDefinition,
  sectorSolids,
  type ShipHullDefinition,
} from '@orbit/catalog';
import {
  type CrewInput,
  ErrorCode,
  INPUT_STALE_MS,
  MAX_CREW,
  type ShipInput,
} from '@orbit/contracts';
import {
  ContinuousInputGate,
  type CrewMovementParams,
  type InputOfferResult,
  type SectorGeometry,
  type ShipKinematics,
  type Vec2,
  distance,
  stepCrew,
  stepShip,
} from '@orbit/simulation';

/** Generous enough for jitter and short stalls, small enough to refuse forged jumps. */
const MAX_SEQ_JUMP = 200;

const NEUTRAL_CREW_INPUT: CrewInput = Object.freeze({ seq: -1, x: 0, y: 0 });
const NEUTRAL_SHIP_INPUT: ShipInput = Object.freeze({ seq: -1, thrust: 0, turn: 0 });

function crewGate(): ContinuousInputGate<CrewInput> {
  return new ContinuousInputGate({
    neutral: NEUTRAL_CREW_INPUT,
    staleAfterMs: INPUT_STALE_MS,
    maxSeqJump: MAX_SEQ_JUMP,
  });
}

function shipGate(): ContinuousInputGate<ShipInput> {
  return new ContinuousInputGate({
    neutral: NEUTRAL_SHIP_INPUT,
    staleAfterMs: INPUT_STALE_MS,
    maxSeqJump: MAX_SEQ_JUMP,
  });
}

export interface CrewRuntime {
  readonly id: string;
  readonly name: string;
  readonly colorIndex: number;
  /** Ship-local position. */
  position: Vec2;
  connected: boolean;
  atHelm: boolean;
  readonly movement: ContinuousInputGate<CrewInput>;
  /** Sequence of the movement input applied on the last tick (-1 when none). */
  lastAppliedSeq: number;
}

export interface ShipRuntime {
  readonly hull: ShipHullDefinition;
  kinematics: ShipKinematics;
  /** Crew member at the helm, or null. Only this member's ship input is applied. */
  operatorId: string | null;
  /** Recreated for every new operator: each client numbers its own inputs. */
  control: ContinuousInputGate<ShipInput>;
}

export type CrewInputResult = InputOfferResult | 'unknown_crew';
export type ShipInputResult = InputOfferResult | 'not_operator';
export type HelmResult =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly code:
        | typeof ErrorCode.HelmOccupied
        | typeof ErrorCode.HelmOutOfRange
        | typeof ErrorCode.NotHelmOperator;
    };

/**
 * Authoritative simulation of one sector instance. Plain TypeScript: no network,
 * no database, no rendering. The room feeds validated intents in and copies the
 * resulting state out after every fixed step.
 */
export class SectorSimulation {
  readonly sector: SectorDefinition;
  readonly ship: ShipRuntime;
  readonly crew = new Map<string, CrewRuntime>();
  tick = 0;
  readonly #crewMovement: CrewMovementParams;
  /** What the ship collides with: asteroids and containers. */
  readonly #geometry: SectorGeometry;

  constructor(
    sector: SectorDefinition = SECTORS[SectorId.Dev],
    hullId: ShipHullId = ShipHullId.Scout,
  ) {
    this.sector = sector;
    this.#geometry = { bounds: sector.bounds, obstacles: sectorSolids(sector) };
    const hull = SHIP_HULLS[hullId];
    this.ship = {
      hull,
      kinematics: {
        position: this.sector.shipSpawn.position,
        velocity: { x: 0, y: 0 },
        angle: this.sector.shipSpawn.angle,
      },
      operatorId: null,
      control: shipGate(),
    };
    this.#crewMovement = {
      speed: CREW.walkSpeed,
      radius: CREW.radius,
      walls: hull.interiorWalls,
      bounds: hull.interiorBounds,
    };
  }

  addCrew(id: string, name: string): CrewRuntime {
    if (this.crew.has(id)) throw new Error(`Tripulante duplicado: ${id}`);
    if (this.crew.size >= MAX_CREW) throw new Error('Tripulação completa');
    const usedColors = new Set([...this.crew.values()].map((member) => member.colorIndex));
    let colorIndex = 0;
    while (usedColors.has(colorIndex)) colorIndex++;
    const member: CrewRuntime = {
      id,
      name,
      colorIndex,
      position: this.#freeSpawn(colorIndex),
      connected: true,
      atHelm: false,
      movement: crewGate(),
      lastAppliedSeq: -1,
    };
    this.crew.set(id, member);
    return member;
  }

  removeCrew(id: string): void {
    this.releaseHelm(id);
    this.crew.delete(id);
  }

  setConnected(id: string, connected: boolean): void {
    const member = this.crew.get(id);
    if (!member) return;
    member.connected = connected;
    // A dropped or returning player starts from neutral; old keys are not replayed.
    member.movement.clear();
    // Nobody keeps the ship hostage while disconnected.
    if (!connected) this.releaseHelm(id);
  }

  /** Takes the helm when it is free and the member stands within reach of the seat. */
  requestHelm(id: string): HelmResult {
    const member = this.crew.get(id);
    if (!member || !member.connected) return { ok: false, code: ErrorCode.HelmOutOfRange };
    if (this.ship.operatorId === id) return { ok: true };
    if (this.ship.operatorId !== null) return { ok: false, code: ErrorCode.HelmOccupied };
    const helm = this.ship.hull.helm;
    if (distance(member.position, helm.seat) > helm.interactRadius) {
      return { ok: false, code: ErrorCode.HelmOutOfRange };
    }
    this.ship.operatorId = id;
    this.ship.control = shipGate();
    member.atHelm = true;
    member.position = helm.seat;
    member.movement.clear();
    return { ok: true };
  }

  releaseHelm(id: string): HelmResult {
    if (this.ship.operatorId !== id) return { ok: false, code: ErrorCode.NotHelmOperator };
    this.ship.operatorId = null;
    this.ship.control.clear();
    const member = this.crew.get(id);
    if (member) {
      member.atHelm = false;
      member.movement.clear();
    }
    return { ok: true };
  }

  offerShipInput(id: string, input: ShipInput, nowMs: number): ShipInputResult {
    if (this.ship.operatorId !== id) return 'not_operator';
    return this.ship.control.offer(input, nowMs);
  }

  /** Records a validated movement intent. It is applied on the next tick, once. */
  offerCrewInput(id: string, input: CrewInput, nowMs: number): CrewInputResult {
    const member = this.crew.get(id);
    if (!member) return 'unknown_crew';
    return member.movement.offer(input, nowMs);
  }

  step(dtSeconds: number, nowMs: number): void {
    this.tick++;
    const control =
      this.ship.operatorId === null ? NEUTRAL_SHIP_INPUT : this.ship.control.current(nowMs);
    this.ship.kinematics = stepShip(
      this.ship.kinematics,
      control,
      dtSeconds,
      this.ship.hull.handling,
      this.#geometry,
    );
    for (const member of this.crew.values()) {
      if (member.atHelm) continue; // Seated operators steer the ship instead of walking.
      const input = member.movement.current(nowMs);
      member.position = stepCrew(member.position, input, dtSeconds, this.#crewMovement);
      member.lastAppliedSeq = input === NEUTRAL_CREW_INPUT ? member.lastAppliedSeq : input.seq;
    }
  }

  #freeSpawn(preferred: number): Vec2 {
    const spawns = this.ship.hull.crewSpawns;
    const occupied = [...this.crew.values()].map((member) => member.position);
    const free = spawns.find((spawn) =>
      occupied.every((position) => distance(position, spawn) > CREW.radius * 2),
    );
    return free ?? spawns[preferred % spawns.length] ?? { x: 0, y: 0 };
  }
}
