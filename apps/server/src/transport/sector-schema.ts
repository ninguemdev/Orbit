import { schema, t, type SchemaType } from '@colyseus/schema';

/** Synchronized room state. Field names mirror `SectorStateView` in @orbit/contracts. */
export const CrewMemberState = schema(
  {
    id: t.string(),
    name: t.string(),
    colorIndex: t.uint8(),
    x: t.float32(),
    y: t.float32(),
    atHelm: t.boolean(),
    connected: t.boolean(),
    lastInputSeq: t.int32(),
  },
  'CrewMember',
);
export type CrewMemberState = SchemaType<typeof CrewMemberState>;

export const ShipState = schema(
  {
    hullId: t.string(),
    x: t.float32(),
    y: t.float32(),
    angle: t.float32(),
    vx: t.float32(),
    vy: t.float32(),
    operatorId: t.string(),
  },
  'Ship',
);
export type ShipState = SchemaType<typeof ShipState>;

export const SectorState = schema(
  {
    protocolVersion: t.uint8(),
    catalogVersion: t.uint16(),
    sectorId: t.string(),
    phase: t.string(),
    tick: t.uint32(),
    ship: ShipState,
    crew: t.map(CrewMemberState),
  },
  'SectorState',
);
export type SectorState = SchemaType<typeof SectorState>;
