import { schema, t, type SchemaType } from '@colyseus/schema';

/** Synchronized party state. Field names mirror `PartyStateView` in @orbit/contracts. */
export const PartyMemberState = schema(
  {
    accountId: t.string().default(''),
    nick: t.string().default(''),
    connected: t.boolean().default(true),
    joinedAt: t.float64().default(0),
    classId: t.string().default(''),
    ships: t.array('string'),
    ready: t.boolean().default(false),
  },
  'PartyMember',
);
export type PartyMemberState = SchemaType<typeof PartyMemberState>;

export const PartyState = schema(
  {
    leaderId: t.string().default(''),
    inviteCode: t.string().default(''),
    selectedShipId: t.string().default(''),
    revision: t.float64().default(1),
    confirmedRevision: t.float64().default(0),
    members: t.map(PartyMemberState),
  },
  'PartyState',
);
export type PartyState = SchemaType<typeof PartyState>;
