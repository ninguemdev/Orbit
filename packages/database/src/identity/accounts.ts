import { eq } from 'drizzle-orm';
import { type AppearanceColorId, isAppearanceColorId } from '@orbit/catalog';
import { nickSchema, normalizeNick } from '@orbit/contracts';
import { type Database, isUniqueViolation } from '../client';
import { grantStarterPackage } from '../inventory/inventory';
import { accounts, profiles } from '../schema';

export interface NewAccount {
  readonly nick: string;
  /** Argon2id hash produced by the identity service; never the password itself. */
  readonly passwordHash: string;
  readonly colorId: AppearanceColorId;
}

export type CreateAccountResult =
  | { readonly ok: true; readonly accountId: string }
  | { readonly ok: false; readonly code: 'nick_taken' | 'invalid_nick' };

/**
 * Creates the account, its profile and the starter package atomically. A nick that differs only in
 * case from an existing one is refused by the unique index, also under concurrency.
 */
export async function createAccount(db: Database, input: NewAccount): Promise<CreateAccountResult> {
  if (!nickSchema.safeParse(input.nick).success) return { ok: false, code: 'invalid_nick' };
  if (!input.passwordHash.startsWith('$argon2id$')) {
    throw new RangeError('Hash de senha precisa ser Argon2id');
  }
  // The database only checks the ID format; the catalog is the source of valid options.
  if (!isAppearanceColorId(input.colorId)) {
    throw new RangeError(`Cor fora do catálogo: ${String(input.colorId)}`);
  }
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
      await grantStarterPackage(tx, account.id);
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
  // Reject before normalizing: some non-ASCII letters lowercase into ASCII (e.g. the Kelvin sign).
  if (!nickSchema.safeParse(nick).success) return null;
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
