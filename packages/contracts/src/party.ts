import { z } from 'zod';
import { nickSchema } from './identity';

/**
 * Parties live in their own Colyseus room. Every signed-in player is always in one
 * (a solo party by default); joining another party leaves the previous one.
 */
export const PARTY_ROOM_NAME = 'party';
export const PARTY_MAX_MEMBERS = 4;
/** Seconds a dropped member keeps their seat. */
export const PARTY_RECONNECTION_SECONDS = 30;
export const PARTY_INVITE_TTL_SECONDS = 60;

/** HTTP route that issues single-use room tickets from the session cookie. */
export const PartyRoute = { Tickets: '/api/party/tickets' } as const;

export const partyTicketRequestSchema = z.discriminatedUnion('intent', [
  z.strictObject({ intent: z.literal('create') }),
  z.strictObject({ intent: z.literal('join'), inviteCode: z.string().min(1).max(16) }),
  z.strictObject({ intent: z.literal('accept'), inviteId: z.uuid() }),
]);
export type PartyTicketRequest = z.infer<typeof partyTicketRequestSchema>;

export interface PartyTicketResponse {
  /** Single-use, short-lived; sent as the matchmaking token. */
  readonly ticket: string;
  /** Room to join with `joinById`; absent for `create`. */
  readonly roomId?: string;
}

export const PartyClientMessage = {
  Invite: 'party.invite',
  Kick: 'party.kick',
  Promote: 'party.promote',
  SelectClass: 'party.class.select',
  SelectShip: 'party.ship.select',
  SetReady: 'party.ready.set',
  Confirm: 'party.confirm',
} as const;

export const PartyServerMessage = {
  InviteReceived: 'party.invite.received',
  Refused: 'party.refused',
  /** The confirmed expedition ended before starting; the reserved items are back. */
  ExpeditionEnded: 'party.expedition.ended',
} as const;

export interface ExpeditionEndedNotice {
  /**
   * `expired`: no match started before the deadline; `party_changed`: the party changed;
   * `aborted`: the match room closed and the reserved items went back (until extraction
   * and settlement exist, this is how a match ends).
   */
  readonly reason: 'expired' | 'party_changed' | 'aborted';
}

export const partyInviteSchema = z.strictObject({ nick: nickSchema });
export const partyMemberTargetSchema = z.strictObject({ accountId: z.uuid() });
/** Class IDs are checked against the versioned catalog by the server. */
export const partySelectClassSchema = z.strictObject({ classId: z.string().min(1).max(64) });
/** Leader only; the ship must be licensed by some current member. */
export const partySelectShipSchema = z.strictObject({ shipId: z.string().min(1).max(64) });
/**
 * Readiness and confirmation name the revision the player saw; a request made on an
 * older revision fails, so nobody confirms a party that changed meanwhile.
 */
const revisionSchema = z.int().min(1).max(Number.MAX_SAFE_INTEGER);
export const partySetReadySchema = z.strictObject({ revision: revisionSchema, ready: z.boolean() });
/** Leader only: freezes the proposed roster of this revision. */
export const partyConfirmSchema = z.strictObject({ revision: revisionSchema });

export const PartyErrorCode = {
  InvalidInviteCode: 'invalid_invite_code',
  InviteNotFound: 'invite_not_found',
  PartyFull: 'party_full',
  PlayerOffline: 'player_offline',
  AlreadyMember: 'already_member',
  NotLeader: 'not_leader',
  NotMember: 'not_member',
  InvalidPayload: 'invalid_payload',
  UnknownClass: 'unknown_class',
  ShipUnavailable: 'ship_unavailable',
  /** The class could not be saved to the account; the previous class stays. */
  ClassNotSaved: 'class_not_saved',
  /** The party changed since the revision named in the request. */
  StaleRevision: 'stale_revision',
  ClassMissing: 'class_missing',
  /** The saved loadout breaks a rule (e.g. a weapon of another class). */
  LoadoutInvalid: 'loadout_invalid',
  ShipMissing: 'ship_missing',
  /** Someone is not ready or not connected. */
  MembersNotReady: 'members_not_ready',
  /** The saved loadouts could not be read now; nothing changed. */
  PreparationUnavailable: 'preparation_unavailable',
  /** A member is already in another expedition. */
  MemberInExpedition: 'member_in_expedition',
} as const;
export type PartyErrorCode = (typeof PartyErrorCode)[keyof typeof PartyErrorCode];

export interface PartyRefusal {
  readonly action: string;
  readonly code: PartyErrorCode;
}

export interface PartyInviteNotice {
  readonly inviteId: string;
  readonly fromNick: string;
  readonly memberCount: number;
  readonly expiresInSeconds: number;
}

/** Close code sent to a member removed by the leader. */
export const PARTY_KICKED_CLOSE_CODE = 4401;
/** Close code sent when the same account entered a party elsewhere (e.g. another tab). */
export const PARTY_MOVED_CLOSE_CODE = 4402;

export interface PartyMemberView {
  readonly accountId: string;
  readonly nick: string;
  readonly connected: boolean;
  readonly joinedAt: number;
  /** Catalog class ID chosen for the next mission; empty until chosen. */
  readonly classId: string;
  /** Ship licenses this member brings; the party may use the union of all members'. */
  readonly ships: { forEach(cb: (shipId: string) => void): void; readonly length: number };
  /** Ready for the current revision; cleared by any relevant change. */
  readonly ready: boolean;
}

export interface PartyStateView {
  readonly leaderId: string;
  readonly inviteCode: string;
  /** Ship chosen by the leader; empty when none or when its last owner left. */
  readonly selectedShipId: string;
  /** Goes up on every change that matters for the mission (roster, class, ship, loadout). */
  readonly revision: number;
  /** Revision whose roster the leader confirmed; 0 when there is no valid confirmation. */
  readonly confirmedRevision: number;
  /** Expedition created by the confirmation; empty when there is none. */
  readonly expeditionId: string;
  /** `PREPARING` while the members load into the match, then `ACTIVE`; empty when none. */
  readonly expeditionState: string;
  /** Seconds before an unstarted preparation is cancelled, counted by the server. */
  readonly prepareSecondsLeft: number;
  /** Accounts in the expedition; members who joined the party later are not in it. */
  readonly expeditionMemberIds: {
    forEach(cb: (accountId: string) => void): void;
    readonly length: number;
  };
  readonly members: {
    forEach(cb: (member: PartyMemberView, accountId: string) => void): void;
    readonly size: number;
  };
}
