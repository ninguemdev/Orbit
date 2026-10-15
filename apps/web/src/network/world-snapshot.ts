import type { SectorStateView } from '@orbit/contracts';

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
