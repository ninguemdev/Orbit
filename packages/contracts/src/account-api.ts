import { LOADOUT_SLOTS, type LoadoutIssue } from '@orbit/catalog';
import { z } from 'zod';
import { nickSchema, passwordSchema } from './identity';

/** HTTP routes of the account API, served by the game server under the same origin policy. */
export const AccountRoute = {
  Accounts: '/api/accounts',
  Sessions: '/api/sessions',
  CurrentSession: '/api/sessions/current',
  Me: '/api/me',
  MyProfile: '/api/me/profile',
  MyRecoveryCode: '/api/me/recovery-code',
  MyInventory: '/api/me/inventory',
  MyStashMove: '/api/me/stash/move',
  /** GET reads, PUT replaces the whole loadout. */
  MyLoadout: '/api/me/loadout',
  Recovery: '/api/recovery',
} as const;

export const SESSION_COOKIE = 'orbit_session';

export const AccountErrorCode = {
  InvalidInput: 'invalid_input',
  NickTaken: 'nick_taken',
  /** Same answer for unknown nick and wrong password: login never reveals which accounts exist. */
  InvalidCredentials: 'invalid_credentials',
  RateLimited: 'rate_limited',
  Unauthenticated: 'unauthenticated',
  OriginNotAllowed: 'origin_not_allowed',
  UnsupportedMediaType: 'unsupported_media_type',
  Overloaded: 'overloaded',
  /** Same answer for unknown nick, wrong code or already used code. */
  InvalidRecovery: 'invalid_recovery',
  /** Party ticket requests (see party.ts for in-room refusals). */
  InvalidInviteCode: 'invalid_invite_code',
  InviteNotFound: 'invite_not_found',
  PartyFull: 'party_full',
  RemovedFromParty: 'removed_from_party',
  EmptySlot: 'empty_slot',
  InvalidSlot: 'invalid_slot',
  InvalidLoadout: 'invalid_loadout',
} as const;
export type AccountErrorCode = (typeof AccountErrorCode)[keyof typeof AccountErrorCode];

export interface AccountErrorBody {
  readonly error: AccountErrorCode;
}

export const credentialsSchema = z.strictObject({ nick: nickSchema, password: passwordSchema });
export type Credentials = z.infer<typeof credentialsSchema>;

/** Login accepts any string within bounds so that a malformed nick gets the same answer as a wrong one. */
export const loginSchema = z.strictObject({
  nick: z.string().min(1).max(64),
  password: z.string().min(1).max(128),
});

export const updateProfileSchema = z.strictObject({ colorId: z.string().max(64) });

export const moveStashSchema = z.strictObject({
  fromSlot: z.int().min(0).max(1000),
  toSlot: z.int().min(0).max(1000),
});

/** Equipment and backpack picks; at most one per loadout slot. */
export const setLoadoutSchema = z.strictObject({
  picks: z
    .array(z.strictObject({ slot: z.string().min(1).max(32), instanceId: z.uuid() }))
    .max(LOADOUT_SLOTS.length),
});

/** One loadout position; `issue` is set when the entry breaks a rule (e.g. after a class change). */
export interface LoadoutEntryView {
  readonly slot: string;
  readonly instanceId: string;
  readonly itemId: string;
  readonly quantity: number;
  readonly issue: LoadoutIssue | null;
}

export interface LoadoutResponse {
  readonly classId: string | null;
  readonly entries: readonly LoadoutEntryView[];
}

/** 422 body of a refused loadout: why each slot was refused. Nothing was saved. */
export interface LoadoutRefusalBody {
  readonly error: typeof AccountErrorCode.InvalidLoadout;
  readonly issues: readonly { readonly slot: string; readonly issue: LoadoutIssue }[];
}

/** Inventory of the session's account; item names and rules come from the catalog. */
export interface InventoryResponse {
  readonly credits: number;
  readonly stashCapacity: number;
  readonly stash: readonly {
    readonly slot: number;
    readonly instanceId: string;
    readonly itemId: string;
    readonly quantity: number;
  }[];
  readonly inbox: readonly {
    readonly entryId: string;
    readonly itemId: string;
    readonly quantity: number;
    readonly reason: string;
  }[];
  readonly ships: readonly { readonly shipId: string }[];
}

export const recoverySchema = z.strictObject({
  nick: z.string().min(1).max(64),
  code: z.string().min(1).max(64),
  newPassword: passwordSchema,
});

/** Shown once after generation; the server keeps only its hash. */
export interface RecoveryCodeResponse {
  readonly code: string;
}

export interface MeResponse {
  readonly account: { readonly id: string; readonly nick: string };
  /** `classId`: class chosen for the next mission, kept across parties and logins. */
  readonly profile: { readonly colorId: string; readonly classId: string | null };
  /** Whether an unused recovery code exists (never the code itself). */
  readonly hasRecoveryCode: boolean;
}
