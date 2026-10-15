import { and, eq, gt, isNull, lt } from 'drizzle-orm';
import type { Database } from '../client';
import { accounts, profiles, sessions } from '../schema';

export interface NewSession {
  readonly accountId: string;
  /** SHA-256 hex of the random token kept in the cookie. */
  readonly tokenHash: string;
  readonly expiresAt: Date;
}

export async function createSession(db: Database, input: NewSession): Promise<string> {
  const [row] = await db.insert(sessions).values(input).returning({ id: sessions.id });
  if (!row) throw new Error('Sessão não criada');
  return row.id;
}

export interface ActiveSession {
  readonly sessionId: string;
  readonly accountId: string;
  readonly nick: string;
  readonly expiresAt: Date;
  readonly lastSeenAt: Date;
}

/** A session counts only if it is not revoked, not expired and its account is active. */
export async function findActiveSession(
  db: Database,
  tokenHash: string,
  now: Date,
): Promise<ActiveSession | null> {
  const [row] = await db
    .select({
      sessionId: sessions.id,
      accountId: sessions.accountId,
      nick: accounts.nick,
      expiresAt: sessions.expiresAt,
      lastSeenAt: sessions.lastSeenAt,
    })
    .from(sessions)
    .innerJoin(accounts, eq(accounts.id, sessions.accountId))
    .where(
      and(
        eq(sessions.tokenHash, tokenHash),
        isNull(sessions.revokedAt),
        gt(sessions.expiresAt, now),
        eq(accounts.status, 'active'),
      ),
    )
    .limit(1);
  return row ?? null;
}

/** Records activity at most once per `minIntervalMs` to avoid a write per request. */
export async function touchSession(
  db: Database,
  sessionId: string,
  now: Date,
  minIntervalMs: number,
): Promise<void> {
  await db
    .update(sessions)
    .set({ lastSeenAt: now })
    .where(
      and(
        eq(sessions.id, sessionId),
        lt(sessions.lastSeenAt, new Date(now.getTime() - minIntervalMs)),
      ),
    );
}

/** Revokes one session of its owner. Returns whether a live session was revoked. */
export async function revokeSession(
  db: Database,
  sessionId: string,
  accountId: string,
  now: Date,
): Promise<boolean> {
  const revoked = await db
    .update(sessions)
    .set({ revokedAt: now })
    .where(
      and(
        eq(sessions.id, sessionId),
        eq(sessions.accountId, accountId),
        isNull(sessions.revokedAt),
      ),
    )
    .returning({ id: sessions.id });
  return revoked.length > 0;
}

export interface ProfileView {
  readonly accountId: string;
  readonly nick: string;
  readonly colorId: string;
}

export async function getProfile(db: Database, accountId: string): Promise<ProfileView | null> {
  const [row] = await db
    .select({ accountId: profiles.accountId, nick: accounts.nick, colorId: profiles.colorId })
    .from(profiles)
    .innerJoin(accounts, eq(accounts.id, profiles.accountId))
    .where(eq(profiles.accountId, accountId))
    .limit(1);
  return row ?? null;
}

/** Updates only the given account's profile; the caller passes a catalog-validated color. */
export async function updateProfileColor(
  db: Database,
  accountId: string,
  colorId: string,
): Promise<void> {
  await db.update(profiles).set({ colorId }).where(eq(profiles.accountId, accountId));
}
