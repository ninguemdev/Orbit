import {
  CREW,
  SECTORS,
  SHIP_HULLS,
  SectorId,
  ShipHullId,
  type SectorDefinition,
  type ShipHullDefinition,
} from '@orbit/catalog';
import { MAX_CREW } from '@orbit/contracts';
import { type ShipKinematics, type Vec2, distance } from '@orbit/simulation';

export interface CrewRuntime {
  readonly id: string;
  readonly name: string;
  readonly colorIndex: number;
  /** Ship-local position. */
  position: Vec2;
  connected: boolean;
}

export interface ShipRuntime {
  readonly hull: ShipHullDefinition;
  kinematics: ShipKinematics;
}

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
    };
    this.crew.set(id, member);
    return member;
  }

  removeCrew(id: string): void {
    this.crew.delete(id);
  }

  setConnected(id: string, connected: boolean): void {
    const member = this.crew.get(id);
    if (member) member.connected = connected;
  }

  step(_dtSeconds: number, _nowMs: number): void {
    this.tick++;
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
