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
}

export interface SectorStateView {
  readonly protocolVersion: number;
  readonly catalogVersion: number;
  readonly sectorId: string;
  readonly phase: RoomPhase;
  readonly tick: number;
  readonly ship: ShipView;
  readonly crew: {
    forEach(cb: (member: CrewMemberView, id: string) => void): void;
    readonly size: number;
  };
}
