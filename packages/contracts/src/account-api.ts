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
  readonly profile: { readonly colorId: string };
  /** Whether an unused recovery code exists (never the code itself). */
  readonly hasRecoveryCode: boolean;
}
