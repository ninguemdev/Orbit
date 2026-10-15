import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AccountRoute, type RecoveryCodeResponse } from '@orbit/contracts';
import { DEFAULT_IDENTITY_POLICY } from '../src/modules/identity/identity-service';
import { ALLOWED_ORIGIN, type ApiServer, call, startApiServer } from './api-harness';

const PASSWORD = 'senha original longa';
const NEW_PASSWORD = 'senha nova bem longa';

describe('account recovery with an optional code', () => {
  let api: ApiServer;
  const post = (path: string, body: unknown, token?: string) =>
    call(api.baseUrl, path, {
      method: 'POST',
      body,
      origin: ALLOWED_ORIGIN,
      ...(token !== undefined ? { token } : {}),
    });
  const me = (token: string | undefined) =>
    call(api.baseUrl, AccountRoute.Me, token !== undefined ? { token } : {});
  const recover = (nick: string, code: string, newPassword = NEW_PASSWORD) =>
    post(AccountRoute.Recovery, { nick, code, newPassword });

  async function accountWithCode(nick: string) {
    const signUp = await post(AccountRoute.Accounts, { nick, password: PASSWORD });
    const generated = await post(AccountRoute.MyRecoveryCode, {}, signUp.token ?? '');
    expect(generated.status).toBe(201);
    return { token: signUp.token, code: (generated.body as RecoveryCodeResponse).code };
  }

  beforeAll(async () => {
    api = await startApiServer({
      ...DEFAULT_IDENTITY_POLICY,
      loginAttemptsPerAddress: 1000,
      signUpsPerAddress: 1000,
    });
  });

  afterAll(async () => {
    await api?.close();
  });

  it('shows the code once and stores only its hash', async () => {
    const { token, code } = await accountWithCode('Guarda_Codigo');
    expect((await me(token)).body).toMatchObject({ hasRecoveryCode: true });
    expect(JSON.stringify((await me(token)).body)).not.toContain(code);
    const stored = await api.pool.query<{ code_hash: string }>(
      `SELECT code_hash FROM account_recovery r JOIN accounts a ON a.id = r.account_id
        WHERE a.nick = 'Guarda_Codigo'`,
    );
    expect(stored.rows).toHaveLength(1);
    expect(stored.rows[0]?.code_hash).not.toContain(code.replace(/-/g, ''));
  });

  it('requires a session to generate a code', async () => {
    expect((await post(AccountRoute.MyRecoveryCode, {})).status).toBe(401);
  });

  it('recovers once: new password works, old one and old sessions stop working', async () => {
    const { token, code } = await accountWithCode('Esqueceu');
    const recovered = await recover('esqueceu', code.toLowerCase());
    expect(recovered.status).toBe(200);
    expect(recovered.body).toMatchObject({ account: { nick: 'Esqueceu' }, hasRecoveryCode: false });
    expect((await me(recovered.token)).status).toBe(200);
    expect((await me(token)).status).toBe(401);

    const oldPassword = await post(AccountRoute.Sessions, { nick: 'Esqueceu', password: PASSWORD });
    expect(oldPassword.status).toBe(401);
    const newPassword = await post(AccountRoute.Sessions, {
      nick: 'Esqueceu',
      password: NEW_PASSWORD,
    });
    expect(newPassword.status).toBe(200);

    expect(await recover('Esqueceu', code, 'outra senha bem longa')).toMatchObject({
      status: 401,
      body: { error: 'invalid_recovery' },
    });
  });

  it('gives the same answer for wrong code, unknown nick and malformed nick', async () => {
    await accountWithCode('Alvo_Codigo');
    const wrong = await recover('Alvo_Codigo', 'AAAA-BBBB-CCCC-DDDD-EEEE-FFFF-GGGG-HHHH');
    const unknown = await recover('Ninguem_Existe', 'AAAA-BBBB-CCCC-DDDD-EEEE-FFFF-GGGG-HHHH');
    const malformed = await recover('com espaço', 'AAAA');
    for (const response of [wrong, unknown, malformed]) {
      expect(response).toMatchObject({ status: 401, body: { error: 'invalid_recovery' } });
      expect(response.token).toBeUndefined();
    }
  });

  it('invalidates the previous code when a new one is generated', async () => {
    const { token, code: first } = await accountWithCode('Troca_Codigo');
    const second = (
      (await post(AccountRoute.MyRecoveryCode, {}, token ?? '')).body as RecoveryCodeResponse
    ).code;
    expect(second).not.toBe(first);
    expect((await recover('Troca_Codigo', first)).status).toBe(401);
    expect((await recover('Troca_Codigo', second)).status).toBe(200);
  });

  it('lets only one of two simultaneous redemptions succeed', async () => {
    const { code } = await accountWithCode('Corrida');
    const results = await Promise.all([
      recover('Corrida', code, 'primeira senha longa'),
      recover('Corrida', code, 'segunda senha longa!'),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual([200, 401]);
  });

  it('limits recovery attempts per nick', async () => {
    await accountWithCode('Forca_Bruta');
    const attempts = await Promise.all(
      Array.from({ length: 8 }, (_, i) => recover('Forca_Bruta', `ZZZZ-${i}`)),
    );
    const statuses = attempts.map((attempt) => attempt.status);
    expect(statuses.filter((status) => status === 429)).toHaveLength(
      8 - DEFAULT_IDENTITY_POLICY.loginFailuresPerNick,
    );
  });
});
