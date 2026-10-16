import type { SectorFeature } from '@orbit/catalog';
import type { ListView, SectorStateView } from '@orbit/contracts';
import type { Circle, Rect } from '@orbit/simulation';

export interface CrewSnapshot {
  readonly id: string;
  readonly name: string;
  readonly colorIndex: number;
  /** Ship-local position. */
  readonly x: number;
  readonly y: number;
  readonly atHelm: boolean;
  readonly connected: boolean;
}

export interface ShipSnapshot {
  readonly hullId: string;
  readonly x: number;
  readonly y: number;
  readonly angle: number;
  readonly operatorId: string;
}

/** Plain copy of one received server state, stamped with local receive time. */
export interface WorldSnapshot {
  readonly receivedAt: number;
  readonly tick: number;
  readonly phase: string;
  readonly ship: ShipSnapshot;
  readonly crew: ReadonlyMap<string, CrewSnapshot>;
}

export function snapshotFromState(state: SectorStateView, receivedAt: number): WorldSnapshot {
  const crew = new Map<string, CrewSnapshot>();
  state.crew.forEach((member, id) => {
    crew.set(id, {
      id,
      name: member.name,
      colorIndex: member.colorIndex,
      x: member.x,
      y: member.y,
      atHelm: member.atHelm,
      connected: member.connected,
    });
  });
  const { ship } = state;
  return {
    receivedAt,
    tick: state.tick,
    phase: state.phase,
    ship: {
      hullId: ship.hullId,
      x: ship.x,
      y: ship.y,
      angle: ship.angle,
      operatorId: ship.operatorId,
    },
    crew,
  };
}

/** Static sector geometry received from the server, as plain data. */
export interface SectorLayout {
  readonly bounds: Rect;
  readonly asteroids: readonly Circle[];
  readonly containers: readonly SectorFeature[];
  readonly extractionZones: readonly SectorFeature[];
}

function toArray<T, U>(list: ListView<T> | undefined, map: (item: T) => U): U[] {
  const result: U[] = [];
  list?.forEach((item) => result.push(map(item)));
  return result;
}

/** Copies the layout once it has arrived; null while the state has no sector yet. */
export function layoutFromState(state: SectorStateView): SectorLayout | null {
  const { layout } = state;
  if (!layout || layout.maxX <= layout.minX || layout.maxY <= layout.minY) return null;
  const feature = ({ id, x, y, radius }: SectorFeature): SectorFeature => ({ id, x, y, radius });
  return {
    bounds: { minX: layout.minX, minY: layout.minY, maxX: layout.maxX, maxY: layout.maxY },
    asteroids: toArray(layout.asteroids, ({ x, y, radius }) => ({ x, y, radius })),
    containers: toArray(layout.containers, feature),
    extractionZones: toArray(layout.extractionZones, feature),
  };
}
