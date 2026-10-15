import { eq } from 'drizzle-orm';
import { normalizeNick } from '@orbit/contracts';
import { type Database, isUniqueViolation } from '../client';
import { accounts, profiles } from '../schema';

export interface NewAccount {
  readonly nick: string;
  /** Argon2id hash produced by the identity service; never the password itself. */
  readonly passwordHash: string;
  readonly colorId: string;
}

export type CreateAccountResult =
  | { readonly ok: true; readonly accountId: string }
  | { readonly ok: false; readonly code: 'nick_taken' };

/**
 * Creates the account and its profile atomically. A nick that differs only in
 * case from an existing one is refused by the unique index, also under concurrency.
 */
export async function createAccount(db: Database, input: NewAccount): Promise<CreateAccountResult> {
  try {
    return await db.transaction(async (tx) => {
      const [account] = await tx
        .insert(accounts)
        .values({
          nick: input.nick,
          nickNormalized: normalizeNick(input.nick),
          passwordHash: input.passwordHash,
        })
        .returning({ id: accounts.id });
      if (!account) throw new Error('Conta não criada');
      await tx.insert(profiles).values({ accountId: account.id, colorId: input.colorId });
      return { ok: true as const, accountId: account.id };
    });
  } catch (error) {
    if (isUniqueViolation(error, 'accounts_nick_normalized_key')) {
      return { ok: false, code: 'nick_taken' };
    }
    throw error;
  }
}

export interface AccountCredentials {
  readonly id: string;
  readonly nick: string;
  readonly passwordHash: string;
  readonly status: string;
}

export async function findAccountByNick(
  db: Database,
  nick: string,
): Promise<AccountCredentials | null> {
  const [row] = await db
    .select({
      id: accounts.id,
      nick: accounts.nick,
      passwordHash: accounts.passwordHash,
      status: accounts.status,
    })
    .from(accounts)
    .where(eq(accounts.nickNormalized, normalizeNick(nick)))
    .limit(1);
  return row ?? null;
}
