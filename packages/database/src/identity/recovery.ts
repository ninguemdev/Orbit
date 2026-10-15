import { and, eq, isNull } from 'drizzle-orm';
import type { Database } from '../client';
import { accountRecovery, accounts, sessions } from '../schema';

/** Replaces any unused code of the account with a new one (stored as SHA-256 hex). */
export async function replaceRecoveryCode(
  db: Database,
  accountId: string,
  codeHash: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .delete(accountRecovery)
      .where(and(eq(accountRecovery.accountId, accountId), isNull(accountRecovery.usedAt)));
    await tx.insert(accountRecovery).values({ accountId, codeHash });
  });
}

export async function hasUnusedRecoveryCode(db: Database, accountId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: accountRecovery.id })
    .from(accountRecovery)
    .where(and(eq(accountRecovery.accountId, accountId), isNull(accountRecovery.usedAt)))
    .limit(1);
  return row !== undefined;
}

export interface RedeemRecovery {
  readonly accountId: string;
  readonly codeHash: string;
  readonly newPasswordHash: string;
  readonly now: Date;
}

/**
 * Consumes the account's unused code if it matches, sets the new password and
 * revokes every session, all in one transaction. The conditional UPDATE makes a
 * code usable once even when two redemptions race.
 */
export async function redeemRecoveryCode(db: Database, input: RedeemRecovery): Promise<boolean> {
  return db.transaction(async (tx) => {
    const used = await tx
      .update(accountRecovery)
      .set({ usedAt: input.now })
      .where(
        and(
          eq(accountRecovery.accountId, input.accountId),
          eq(accountRecovery.codeHash, input.codeHash),
          isNull(accountRecovery.usedAt),
        ),
      )
      .returning({ id: accountRecovery.id });
    if (used.length === 0) return false;
    await tx
      .update(accounts)
      .set({ passwordHash: input.newPasswordHash })
      .where(eq(accounts.id, input.accountId));
    await tx
      .update(sessions)
      .set({ revokedAt: input.now })
      .where(and(eq(sessions.accountId, input.accountId), isNull(sessions.revokedAt)));
    return true;
  });
}
