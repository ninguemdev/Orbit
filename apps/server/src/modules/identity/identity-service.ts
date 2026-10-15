import { DEFAULT_APPEARANCE_COLOR, isAppearanceColorId } from '@orbit/catalog';
import {
  AccountErrorCode,
  type MeResponse,
  credentialsSchema,
  loginSchema,
  nickSchema,
  normalizeNick,
} from '@orbit/contracts';
import {
  type ActiveSession,
  type Database,
  createAccount,
  createSession,
  findAccountByNick,
  findActiveSession,
  getProfile,
  revokeSession,
  touchSession,
  updateProfileColor,
} from '@orbit/database';
import { SlidingWindowLimiter } from '../../infrastructure/sliding-window-limiter';
import type { PasswordHasher } from './password-hasher';
import { generateSessionToken, hashSessionToken, isWellFormedToken } from './session-token';

export interface IdentityPolicy {
  readonly sessionTtlMs: number;
  /** Login attempts per client address per window. */
  readonly loginAttemptsPerAddress: number;
  /** Login attempts per nick per window without a success before that nick is refused. */
  readonly loginFailuresPerNick: number;
  readonly signUpsPerAddress: number;
  readonly limitWindowMs: number;
}

export const DEFAULT_IDENTITY_POLICY: IdentityPolicy = {
  sessionTtlMs: 7 * 24 * 60 * 60 * 1000,
  loginAttemptsPerAddress: 20,
  loginFailuresPerNick: 5,
  signUpsPerAddress: 5,
  limitWindowMs: 15 * 60 * 1000,
};

const TOUCH_INTERVAL_MS = 5 * 60 * 1000;

export interface IssuedSession {
  readonly token: string;
  readonly expiresAt: Date;
}

export type IdentityFailure = {
  readonly ok: false;
  readonly code: AccountErrorCode;
};

export type SignedIn = {
  readonly ok: true;
  readonly me: MeResponse;
  readonly session: IssuedSession;
};

/** Account use cases: sign-up, login, session check, logout and own profile. */
export class IdentityService {
  readonly #db: Database;
  readonly #hasher: PasswordHasher;
  readonly #now: () => Date;
  readonly #policy: IdentityPolicy;
  readonly #loginByAddress: SlidingWindowLimiter;
  readonly #failuresByNick: SlidingWindowLimiter;
  readonly #signUpsByAddress: SlidingWindowLimiter;

  constructor(deps: {
    db: Database;
    hasher: PasswordHasher;
    now?: () => Date;
    policy?: IdentityPolicy;
  }) {
    this.#db = deps.db;
    this.#hasher = deps.hasher;
    this.#now = deps.now ?? (() => new Date());
    this.#policy = deps.policy ?? DEFAULT_IDENTITY_POLICY;
    const window = { windowMs: this.#policy.limitWindowMs, now: () => this.#now().getTime() };
    this.#loginByAddress = new SlidingWindowLimiter({
      limit: this.#policy.loginAttemptsPerAddress,
      ...window,
    });
    this.#failuresByNick = new SlidingWindowLimiter({
      limit: this.#policy.loginFailuresPerNick,
      ...window,
    });
    this.#signUpsByAddress = new SlidingWindowLimiter({
      limit: this.#policy.signUpsPerAddress,
      ...window,
    });
  }

  async signUp(input: unknown, address: string): Promise<SignedIn | IdentityFailure> {
    const parsed = credentialsSchema.safeParse(input);
    if (!parsed.success) return { ok: false, code: AccountErrorCode.InvalidInput };
    if (!this.#signUpsByAddress.tryConsume(address)) {
      return { ok: false, code: AccountErrorCode.RateLimited };
    }
    const { nick, password } = parsed.data;
    const passwordHash = await this.#hasher.hash(password);
    const created = await createAccount(this.#db, {
      nick,
      passwordHash,
      colorId: DEFAULT_APPEARANCE_COLOR,
    });
    if (!created.ok) {
      return {
        ok: false,
        code:
          created.code === 'nick_taken'
            ? AccountErrorCode.NickTaken
            : AccountErrorCode.InvalidInput,
      };
    }
    return this.#issue(created.accountId);
  }

  /**
   * Verifies nick and password. Unknown nicks cost the same hashing work as wrong
   * passwords and get the same answer, so the response does not reveal accounts.
   */
  async login(input: unknown, address: string): Promise<SignedIn | IdentityFailure> {
    const parsed = loginSchema.safeParse(input);
    if (!parsed.success) return { ok: false, code: AccountErrorCode.InvalidInput };
    if (!this.#loginByAddress.tryConsume(address)) {
      return { ok: false, code: AccountErrorCode.RateLimited };
    }
    // Only well-formed nicks can exist, so only they get a per-nick counter. The attempt
    // is counted before hashing: concurrent guesses cannot all pass a later check.
    const validNick = nickSchema.safeParse(parsed.data.nick).success;
    const nickKey = normalizeNick(parsed.data.nick);
    if (validNick && !this.#failuresByNick.tryConsume(nickKey)) {
      return { ok: false, code: AccountErrorCode.RateLimited };
    }
    const account = validNick ? await findAccountByNick(this.#db, parsed.data.nick) : null;
    let valid = false;
    if (account?.status === 'active') {
      valid = await this.#hasher.verify(account.passwordHash, parsed.data.password);
    } else {
      await this.#hasher.verifyDummy(parsed.data.password);
    }
    if (!valid || !account) return { ok: false, code: AccountErrorCode.InvalidCredentials };
    this.#failuresByNick.reset(nickKey);
    return this.#issue(account.id);
  }

  /** Resolves a cookie token to its live session; refreshes activity at most every 5 min. */
  async authenticate(token: string | undefined): Promise<ActiveSession | null> {
    if (!token || !isWellFormedToken(token)) return null;
    const now = this.#now();
    const session = await findActiveSession(this.#db, hashSessionToken(token), now);
    if (session && now.getTime() - session.lastSeenAt.getTime() >= TOUCH_INTERVAL_MS) {
      await touchSession(this.#db, session.sessionId, now, TOUCH_INTERVAL_MS);
    }
    return session;
  }

  async logout(session: ActiveSession): Promise<void> {
    await revokeSession(this.#db, session.sessionId, session.accountId, this.#now());
  }

  async me(accountId: string): Promise<MeResponse | null> {
    const profile = await getProfile(this.#db, accountId);
    if (!profile) return null;
    return {
      account: { id: profile.accountId, nick: profile.nick },
      profile: { colorId: profile.colorId },
    };
  }

  /** Changes the caller's own profile; the account always comes from the session. */
  async updateColor(accountId: string, colorId: string): Promise<MeResponse | IdentityFailure> {
    if (!isAppearanceColorId(colorId)) return { ok: false, code: AccountErrorCode.InvalidInput };
    await updateProfileColor(this.#db, accountId, colorId);
    const me = await this.me(accountId);
    return me ?? { ok: false, code: AccountErrorCode.Unauthenticated };
  }

  async #issue(accountId: string): Promise<SignedIn | IdentityFailure> {
    const { token, tokenHash } = generateSessionToken();
    const expiresAt = new Date(this.#now().getTime() + this.#policy.sessionTtlMs);
    await createSession(this.#db, { accountId, tokenHash, expiresAt });
    const me = await this.me(accountId);
    if (!me) return { ok: false, code: AccountErrorCode.Unauthenticated };
    return { ok: true, me, session: { token, expiresAt } };
  }
}
