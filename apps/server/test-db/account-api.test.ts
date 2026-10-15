import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppearanceColorId } from '@orbit/catalog';
import { AccountRoute } from '@orbit/contracts';
import { DEFAULT_IDENTITY_POLICY } from '../src/modules/identity/identity-service';
import { ALLOWED_ORIGIN, type ApiServer, call, startApiServer } from './api-harness';

const PASSWORD = 'correct horse battery';

describe('account API', () => {
  let api: ApiServer;
  const post = (path: string, body: unknown, extra: object = {}) =>
    call(api.baseUrl, path, { method: 'POST', body, origin: ALLOWED_ORIGIN, ...extra });
  const signUp = (nick: string, password = PASSWORD) =>
    post(AccountRoute.Accounts, { nick, password });
  const login = (nick: string, password = PASSWORD) =>
    post(AccountRoute.Sessions, { nick, password });
  const me = (token: string | undefined, origin?: string) =>
    call(api.baseUrl, AccountRoute.Me, {
      ...(token !== undefined ? { token } : {}),
      ...(origin ? { origin } : {}),
    });

  beforeAll(async () => {
    // Address limits high enough for this file; their behavior is tested at the service level.
    api = await startApiServer({
      ...DEFAULT_IDENTITY_POLICY,
      loginAttemptsPerAddress: 1000,
      signUpsPerAddress: 1000,
    });
  });

  afterAll(async () => {
    await api?.close();
  });

  it('signs up with nick and password only and opens an HttpOnly session', async () => {
    const response = await signUp('Pioneira');
    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      account: { nick: 'Pioneira' },
      profile: { colorId: AppearanceColorId.Cyan },
    });
    const cookie = response.headers.get('set-cookie') ?? '';
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Strict/);
    expect(cookie).toMatch(/Max-Age=(604800|6047[0-9]{2})(;|$)/); // 7 days, within clock rounding
    expect((await me(response.token)).status).toBe(200);

    const stored = await api.pool.query<{ password_hash: string; token_hash: string }>(
      `SELECT a.password_hash, s.token_hash FROM accounts a JOIN sessions s ON s.account_id = a.id
        WHERE a.nick = 'Pioneira'`,
    );
    expect(stored.rows[0]?.password_hash.startsWith('$argon2id$v=19$m=19456,t=2,p=1$')).toBe(true);
    expect(stored.rows[0]?.password_hash).not.toContain(PASSWORD);
    expect(stored.rows[0]?.token_hash).not.toBe(response.token);
  });

  it('refuses a nick that differs only in case', async () => {
    const response = await signUp('PIONEIRA');
    expect(response).toMatchObject({ status: 409, body: { error: 'nick_taken' } });
    expect(response.token).toBeUndefined();
  });

  it.each([
    ['short password', { nick: 'Curta', password: 'curta' }],
    ['invalid nick', { nick: 'no spaces', password: PASSWORD }],
    ['extra field', { nick: 'Extra', password: PASSWORD, accountId: 'x' }],
  ])('rejects sign-up with %s', async (_label, body) => {
    expect(await post(AccountRoute.Accounts, body)).toMatchObject({
      status: 400,
      body: { error: 'invalid_input' },
    });
  });

  it('rejects non-JSON and malformed bodies', async () => {
    expect(
      await post(AccountRoute.Sessions, undefined, {
        rawBody: 'nick=a',
        contentType: 'text/plain',
      }),
    ).toMatchObject({ status: 415, body: { error: 'unsupported_media_type' } });
    expect(await post(AccountRoute.Sessions, undefined, { rawBody: '{"nick":' })).toMatchObject({
      status: 400,
      body: { error: 'invalid_input' },
    });
  });

  it('logs in with the right password and gives the same answer for wrong password or unknown nick', async () => {
    const ok = await login('pioneira');
    expect(ok.status).toBe(200);
    expect((await me(ok.token)).body).toMatchObject({ account: { nick: 'Pioneira' } });

    const wrong = await login('Pioneira', 'wrong password!!');
    const unknown = await login('Ninguem_Aqui', 'wrong password!!');
    expect(wrong).toMatchObject({ status: 401, body: { error: 'invalid_credentials' } });
    expect(unknown).toMatchObject({ status: 401, body: wrong.body });
    expect(wrong.token).toBeUndefined();
  });

  it('logout revokes the session on the server and clears the cookie', async () => {
    const { token } = await login('Pioneira');
    const other = await login('Pioneira');
    const out = await call(api.baseUrl, AccountRoute.CurrentSession, {
      method: 'DELETE',
      token: token ?? '',
      origin: ALLOWED_ORIGIN,
    });
    expect(out.status).toBe(204);
    expect(out.token).toBe('');
    expect(await me(token)).toMatchObject({ status: 401, body: { error: 'unauthenticated' } });
    expect((await me(other.token)).status).toBe(200); // other devices stay signed in
  });

  it('rejects expired sessions and sessions of disabled accounts', async () => {
    const { token } = await signUp('Expirada');
    await api.pool.query(
      `UPDATE sessions SET created_at = now() - interval '8 days', expires_at = now() - interval '1 day'
        WHERE account_id = (SELECT id FROM accounts WHERE nick = 'Expirada')`,
    );
    expect((await me(token)).status).toBe(401);

    const disabled = await signUp('Bloqueada');
    await api.pool.query(`UPDATE accounts SET status = 'disabled' WHERE nick = 'Bloqueada'`);
    expect((await me(disabled.token)).status).toBe(401);
    expect(await login('Bloqueada')).toMatchObject({
      status: 401,
      body: { error: 'invalid_credentials' },
    });
  });

  it('ignores malformed or forged cookies', async () => {
    expect((await me('x')).status).toBe(401);
    expect((await me('A'.repeat(43))).status).toBe(401);
  });

  it('refuses state changes from other origins (CSRF) and never grants them CORS', async () => {
    const evil = 'http://evil.example';
    expect(
      await post(AccountRoute.Sessions, { nick: 'Pioneira', password: PASSWORD }, { origin: evil }),
    ).toMatchObject({
      status: 403,
      body: { error: 'origin_not_allowed' },
    });
    const { token } = await login('Pioneira');
    const patch = await call(api.baseUrl, AccountRoute.MyProfile, {
      method: 'PATCH',
      body: { colorId: AppearanceColorId.Pink },
      token: token ?? '',
      origin: evil,
    });
    expect(patch.status).toBe(403);
    expect((await me(token)).body).toMatchObject({ profile: { colorId: AppearanceColorId.Cyan } });

    expect((await me(token, ALLOWED_ORIGIN)).headers.get('access-control-allow-origin')).toBe(
      ALLOWED_ORIGIN,
    );
    expect((await me(token, evil)).headers.get('access-control-allow-origin')).toBeNull();
    const preflight = await fetch(api.baseUrl + AccountRoute.MyProfile, {
      method: 'OPTIONS',
      headers: { origin: evil, 'access-control-request-method': 'PATCH' },
    });
    expect(preflight.headers.get('access-control-allow-origin')).toBeNull();
    expect(preflight.headers.get('access-control-allow-credentials')).toBeNull();
  });

  it('private routes act only on the account of the session', async () => {
    const a = await signUp('Conta_A');
    const b = await signUp('Conta_B');
    const changed = await call(api.baseUrl, AccountRoute.MyProfile, {
      method: 'PATCH',
      body: { colorId: AppearanceColorId.Green },
      token: a.token ?? '',
      origin: ALLOWED_ORIGIN,
    });
    expect(changed.body).toMatchObject({
      account: { nick: 'Conta_A' },
      profile: { colorId: AppearanceColorId.Green },
    });
    expect((await me(b.token)).body).toMatchObject({
      profile: { colorId: AppearanceColorId.Cyan },
    });

    // The target account cannot be chosen by the client, and unknown colors are refused.
    for (const body of [
      { colorId: AppearanceColorId.Pink, accountId: 'x' },
      { colorId: 'appearance.color.purple' },
    ]) {
      const refused = await call(api.baseUrl, AccountRoute.MyProfile, {
        method: 'PATCH',
        body,
        token: a.token ?? '',
        origin: ALLOWED_ORIGIN,
      });
      expect(refused).toMatchObject({ status: 400, body: { error: 'invalid_input' } });
    }
    expect(
      (
        await call(api.baseUrl, AccountRoute.MyProfile, {
          method: 'PATCH',
          body: { colorId: AppearanceColorId.Pink },
          origin: ALLOWED_ORIGIN,
        })
      ).status,
    ).toBe(401);
  });

  it('locks a nick after repeated wrong passwords, even for the right one', async () => {
    await signUp('Alvo_Brute');
    for (let i = 0; i < DEFAULT_IDENTITY_POLICY.loginFailuresPerNick; i++) {
      expect((await login('Alvo_Brute', `tentativa errada ${i}`)).status).toBe(401);
    }
    expect(await login('alvo_brute')).toMatchObject({
      status: 429,
      body: { error: 'rate_limited' },
    });
  });

  it('serves concurrent logins while hashing at most two passwords at a time', async () => {
    await signUp('Muitos_Logins');
    const results = await Promise.all(Array.from({ length: 8 }, () => login('Muitos_Logins')));
    expect(results.map((result) => result.status)).toEqual(Array(8).fill(200));
    expect(new Set(results.map((result) => result.token)).size).toBe(8);
    expect(api.hasher.peakConcurrency).toBe(2);
  });
});
