/**
 * Read-only shape of the synchronized room state as seen by clients. The server
 * owns the authoritative Schema; clients only read these fields.
 */
export const RoomPhase = {
  Preparing: 'PREPARING',
  Active: 'ACTIVE',
  Extracting: 'EXTRACTING',
  Settling: 'SETTLING',
  Closed: 'CLOSED',
  Cancelled: 'CANCELLED',
  Failed: 'FAILED',
  AbortedTechnical: 'ABORTED_TECHNICAL',
} as const;
export type RoomPhase = (typeof RoomPhase)[keyof typeof RoomPhase];

export interface CrewMemberView {
  readonly id: string;
  readonly name: string;
  readonly colorIndex: number;
  /** Position in the ship's local coordinates. */
  readonly x: number;
  readonly y: number;
  readonly atHelm: boolean;
  readonly connected: boolean;
  /** Last movement input sequence applied by the server. */
  readonly lastInputSeq: number;
}

export interface ShipView {
  readonly hullId: string;
  readonly x: number;
  readonly y: number;
  readonly angle: number;
  readonly vx: number;
  readonly vy: number;
  /** Session id of the helm operator, or empty. */
  readonly operatorId: string;
  readonly hullPoints: number;
  readonly maxHullPoints: number;
}

/** Read-only list as the client SDK exposes synchronized arrays. */
export interface ListView<T> {
  forEach(cb: (item: T, index: number) => void): void;
  readonly length: number;
}

export interface AsteroidView {
  readonly x: number;
  readonly y: number;
  readonly radius: number;
}

export interface SectorFeatureView {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly radius: number;
}

/**
 * Static geometry of the sector, sent once on entry. It holds only what players may
 * see: never the seed nor what the containers hold.
 */
export interface SectorLayoutView {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
  readonly asteroids: ListView<AsteroidView>;
  readonly containers: ListView<SectorFeatureView>;
  readonly extractionZones: ListView<SectorFeatureView>;
}

export interface SectorStateView {
  readonly protocolVersion: number;
  readonly catalogVersion: number;
  readonly sectorId: string;
  readonly phase: RoomPhase;
  readonly tick: number;
  readonly layout: SectorLayoutView;
  readonly ship: ShipView;
  readonly crew: {
    forEach(cb: (member: CrewMemberView, id: string) => void): void;
    get(id: string): CrewMemberView | undefined;
    readonly size: number;
  };
  /** 'active' | 'extracted' | 'destroyed' | 'timeout'; only set with extraction rules. */
  readonly missionOutcome: string;
  readonly evacuationCounting: boolean;
  readonly evacuationSecondsLeft: number;
}
