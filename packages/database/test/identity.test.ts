import { createHash, randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_APPEARANCE_COLOR } from '@orbit/catalog';
import { postgresError } from '../src/client';
import { createAccount, findAccountByNick } from '../src/identity/accounts';
import { FAKE_ARGON2ID_HASH, type TestDatabase, createTestDatabase } from './test-database';

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

describe('identity schema', () => {
  let t: TestDatabase;

  beforeAll(async () => {
    t = await createTestDatabase();
  });

  afterAll(async () => {
    await t.drop();
  });

  const newAccount = (nick: string) =>
    createAccount(t.db, {
      nick,
      passwordHash: FAKE_ARGON2ID_HASH,
      colorId: DEFAULT_APPEARANCE_COLOR,
    });

  async function sqlError(query: string, params: unknown[] = []) {
    try {
      await t.pool.query(query, params);
    } catch (error) {
      return postgresError(error);
    }
    return null;
  }

  it('creates an account with its profile and finds it by nick in any case', async () => {
    const created = await newAccount('Capitao_01');
    expect(created.ok).toBe(true);
    const found = await findAccountByNick(t.db, 'CAPITAO_01');
    expect(found).toMatchObject({ nick: 'Capitao_01', status: 'active' });
    const profile = await t.pool.query('SELECT color_id FROM profiles WHERE account_id = $1', [
      found?.id,
    ]);
    expect(profile.rows).toEqual([{ color_id: DEFAULT_APPEARANCE_COLOR }]);
  });

  it('allows exactly one of concurrent sign-ups for the same normalized nick', async () => {
    const variants = ['Orion', 'ORION', 'orion', 'oRiOn', 'OrIoN', 'orioN'];
    const results = await Promise.all(variants.map(newAccount));
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.filter((result) => !result.ok)).toEqual(
      Array.from({ length: variants.length - 1 }, () => ({ ok: false, code: 'nick_taken' })),
    );
    const rows = await t.pool.query(
      `SELECT count(*)::int AS accounts,
              (SELECT count(*)::int FROM profiles p JOIN accounts a ON a.id = p.account_id
                WHERE a.nick_normalized = 'orion') AS profiles
         FROM accounts WHERE nick_normalized = 'orion'`,
    );
    expect(rows.rows).toEqual([{ accounts: 1, profiles: 1 }]);
  });

  it('rolls back the account when the profile cannot be created', async () => {
    await expect(
      createAccount(t.db, {
        nick: 'Sem_Perfil',
        passwordHash: FAKE_ARGON2ID_HASH,
        colorId: 'roxo',
      }),
    ).rejects.toThrow();
    expect(await findAccountByNick(t.db, 'Sem_Perfil')).toBeNull();
  });

  it('refuses raw passwords, invalid nicks and inconsistent normalization', async () => {
    const insert =
      'INSERT INTO accounts (nick, nick_normalized, password_hash) VALUES ($1, $2, $3)';
    expect(await sqlError(insert, ['Bruto', 'bruto', 'senha-em-texto-puro'])).toMatchObject({
      code: '23514',
      constraint: 'accounts_password_hash_argon2id',
    });
    expect(await sqlError(insert, ['ab', 'ab', FAKE_ARGON2ID_HASH])).toMatchObject({
      constraint: 'accounts_nick_format',
    });
    expect(await sqlError(insert, ['Nome_X', 'nome_y', FAKE_ARGON2ID_HASH])).toMatchObject({
      constraint: 'accounts_nick_normalized_matches',
    });
  });

  it('stores only token hashes in sessions and keeps them unique', async () => {
    const account = await newAccount('Sessao_A');
    if (!account.ok) throw new Error('conta não criada');
    const token = randomBytes(32).toString('base64url');
    const insert =
      "INSERT INTO sessions (account_id, token_hash, expires_at) VALUES ($1, $2, now() + interval '7 days')";
    expect(await sqlError(insert, [account.accountId, token])).toMatchObject({
      constraint: 'sessions_token_hash_sha256_hex',
    });
    await t.pool.query(insert, [account.accountId, sha256(token)]);
    expect(await sqlError(insert, [account.accountId, sha256(token)])).toMatchObject({
      code: '23505',
      constraint: 'sessions_token_hash_key',
    });
    const expired =
      "INSERT INTO sessions (account_id, token_hash, expires_at) VALUES ($1, $2, now() - interval '1 second')";
    expect(await sqlError(expired, [account.accountId, sha256('outro')])).toMatchObject({
      constraint: 'sessions_expires_after_creation',
    });
  });

  it('keeps at most one unused recovery code per account', async () => {
    const account = await newAccount('Recupera');
    if (!account.ok) throw new Error('conta não criada');
    const insert =
      'INSERT INTO account_recovery (account_id, code_hash) VALUES ($1, $2) RETURNING id';
    const first = await t.pool.query<{ id: string }>(insert, [
      account.accountId,
      sha256('codigo-1'),
    ]);
    expect(await sqlError(insert, [account.accountId, sha256('codigo-2')])).toMatchObject({
      code: '23505',
      constraint: 'account_recovery_one_unused_per_account',
    });
    await t.pool.query('UPDATE account_recovery SET used_at = now() WHERE id = $1', [
      first.rows[0]?.id,
    ]);
    await expect(
      t.pool.query(insert, [account.accountId, sha256('codigo-2')]),
    ).resolves.toBeTruthy();
  });

  it('removes sessions, recovery codes and profile with the account', async () => {
    const found = await findAccountByNick(t.db, 'Sessao_A');
    await t.pool.query('DELETE FROM accounts WHERE id = $1', [found?.id]);
    const left = await t.pool.query(
      `SELECT (SELECT count(*)::int FROM sessions WHERE account_id = $1) AS sessions,
              (SELECT count(*)::int FROM profiles WHERE account_id = $1) AS profiles`,
      [found?.id],
    );
    expect(left.rows).toEqual([{ sessions: 0, profiles: 0 }]);
  });
});
