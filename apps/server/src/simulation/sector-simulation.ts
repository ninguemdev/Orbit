import {
  CREW,
  SECTORS,
  SHIP_HULLS,
  SectorId,
  ShipHullId,
  type SectorDefinition,
  type ShipHullDefinition,
} from '@orbit/catalog';
import { type CrewInput, INPUT_STALE_MS, MAX_CREW } from '@orbit/contracts';
import {
  ContinuousInputGate,
  type CrewMovementParams,
  type InputOfferResult,
  type ShipKinematics,
  type Vec2,
  distance,
  stepCrew,
} from '@orbit/simulation';

/** Generous enough for jitter and short stalls, small enough to refuse forged jumps. */
const MAX_SEQ_JUMP = 200;

const NEUTRAL_CREW_INPUT: CrewInput = Object.freeze({ seq: -1, x: 0, y: 0 });

export interface CrewRuntime {
  readonly id: string;
  readonly name: string;
  readonly colorIndex: number;
  /** Ship-local position. */
  position: Vec2;
  connected: boolean;
  readonly movement: ContinuousInputGate<CrewInput>;
  /** Sequence of the movement input applied on the last tick (-1 when none). */
  lastAppliedSeq: number;
}

export interface ShipRuntime {
  readonly hull: ShipHullDefinition;
  kinematics: ShipKinematics;
}

export type CrewInputResult = InputOfferResult | 'unknown_crew';

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

  constructor(sectorId: SectorId = SectorId.Dev, hullId: ShipHullId = ShipHullId.Scout) {
    this.sector = SECTORS[sectorId];
    const hull = SHIP_HULLS[hullId];
    this.ship = {
      hull,
      kinematics: {
        position: this.sector.shipSpawn.position,
        velocity: { x: 0, y: 0 },
        angle: this.sector.shipSpawn.angle,
      },
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
      movement: new ContinuousInputGate({
        neutral: NEUTRAL_CREW_INPUT,
        staleAfterMs: INPUT_STALE_MS,
        maxSeqJump: MAX_SEQ_JUMP,
      }),
      lastAppliedSeq: -1,
    };
    this.crew.set(id, member);
    return member;
  }

  removeCrew(id: string): void {
    this.crew.delete(id);
  }

  setConnected(id: string, connected: boolean): void {
    const member = this.crew.get(id);
    if (!member) return;
    member.connected = connected;
    // A dropped or returning player starts from neutral; old keys are not replayed.
    member.movement.clear();
  }

  /** Records a validated movement intent. It is applied on the next tick, once. */
  offerCrewInput(id: string, input: CrewInput, nowMs: number): CrewInputResult {
    const member = this.crew.get(id);
    if (!member) return 'unknown_crew';
    return member.movement.offer(input, nowMs);
  }

  step(dtSeconds: number, nowMs: number): void {
    this.tick++;
    for (const member of this.crew.values()) {
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
