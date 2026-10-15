import { schema, t, type SchemaType } from '@colyseus/schema';

/** Synchronized room state. Field names mirror `SectorStateView` in @orbit/contracts. */
export const CrewMemberState = schema(
  {
    id: t.string().default(''),
    name: t.string().default(''),
    colorIndex: t.uint8().default(0),
    x: t.float32().default(0),
    y: t.float32().default(0),
    atHelm: t.boolean().default(false),
    connected: t.boolean().default(false),
    lastInputSeq: t.int32().default(-1),
  },
  'CrewMember',
);
export type CrewMemberState = SchemaType<typeof CrewMemberState>;

export const ShipState = schema(
  {
    hullId: t.string().default(''),
    x: t.float32().default(0),
    y: t.float32().default(0),
    angle: t.float32().default(0),
    vx: t.float32().default(0),
    vy: t.float32().default(0),
    operatorId: t.string().default(''),
  },
  'Ship',
);
export type ShipState = SchemaType<typeof ShipState>;

export const SectorState = schema(
  {
    protocolVersion: t.uint8().default(0),
    catalogVersion: t.uint16().default(0),
    sectorId: t.string().default(''),
    phase: t.string().default(''),
    tick: t.uint32().default(0),
    ship: ShipState,
    crew: t.map(CrewMemberState),
  },
  'SectorState',
);
export type SectorState = SchemaType<typeof SectorState>;
