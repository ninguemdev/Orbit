import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AccountRoute, PartyRoute } from '@orbit/contracts';
import { DEFAULT_IDENTITY_POLICY } from '../src/modules/identity/identity-service';
import { ALLOWED_ORIGIN, type ApiServer, call, startApiServer } from './api-harness';

/** Every route that acts on the session's account, with a valid body for it. */
const SESSION_ROUTES: readonly { method: string; path: string; body?: unknown }[] = [
  { method: 'GET', path: AccountRoute.Me },
  { method: 'PATCH', path: AccountRoute.MyProfile, body: { colorId: 'appearance.color.amber' } },
  { method: 'POST', path: AccountRoute.MyRecoveryCode, body: {} },
  { method: 'GET', path: AccountRoute.MyInventory },
  { method: 'POST', path: AccountRoute.MyStashMove, body: { fromSlot: 0, toSlot: 1 } },
  { method: 'GET', path: AccountRoute.MyLoadout },
  { method: 'PUT', path: AccountRoute.MyLoadout, body: { picks: [] } },
  { method: 'POST', path: PartyRoute.Tickets, body: { intent: 'create' } },
];
const UNSAFE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
/** Routes open without a session (they create or end one, or recover access). */
const PUBLIC_ROUTES: readonly string[] = [
  AccountRoute.Accounts,
  AccountRoute.Sessions,
  AccountRoute.CurrentSession,
  AccountRoute.Recovery,
];

describe('authorization regression (0.2 gate)', () => {
  let api: ApiServer;
  let counter = 0;

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

  async function signUp() {
    const nick = `Autoriza_${++counter}`;
    const response = await call(api.baseUrl, AccountRoute.Accounts, {
      method: 'POST',
      origin: ALLOWED_ORIGIN,
      body: { nick, password: 'senha de autorizacao longa' },
    });
    return { nick, token: response.token ?? '' };
  }

  const request = (
    route: (typeof SESSION_ROUTES)[number],
    token: string | undefined,
    origin: string | undefined,
  ) =>
    call(api.baseUrl, route.path, {
      method: route.method,
      ...(token !== undefined ? { token } : {}),
      ...(origin !== undefined ? { origin } : {}),
      ...(route.body !== undefined ? { body: route.body } : {}),
    });

  it('covers every route of the API in this matrix', () => {
    // A route added later must be listed here as public or as needing a session.
    const listed = new Set([...PUBLIC_ROUTES, ...SESSION_ROUTES.map((route) => route.path)]);
    for (const path of [...Object.values(AccountRoute), ...Object.values(PartyRoute)]) {
      expect({ path, listed: listed.has(path) }).toEqual({ path, listed: true });
    }
  });

  it('answers 401 on every account route without a session or with a made-up one', async () => {
    for (const route of SESSION_ROUTES) {
      const origin = UNSAFE.has(route.method) ? ALLOWED_ORIGIN : undefined;
      for (const token of [undefined, 'x'.repeat(43)]) {
        const response = await request(route, token, origin);
        expect({ route: `${route.method} ${route.path}`, status: response.status }).toEqual({
          route: `${route.method} ${route.path}`,
          status: 401,
        });
      }
    }
  });

  it('answers 401 with a session that was signed out', async () => {
    const player = await signUp();
    await call(api.baseUrl, AccountRoute.CurrentSession, {
      method: 'DELETE',
      origin: ALLOWED_ORIGIN,
      token: player.token,
    });
    for (const route of SESSION_ROUTES) {
      const origin = UNSAFE.has(route.method) ? ALLOWED_ORIGIN : undefined;
      expect((await request(route, player.token, origin)).status).toBe(401);
    }
  });

  it('refuses writes from another origin before looking at the session', async () => {
    // The Origin check runs first, so a stolen cookie sent cross-site changes nothing.
    // (A missing Origin is allowed only by development servers; the harness is one.)
    const player = await signUp();
    for (const route of SESSION_ROUTES.filter((entry) => UNSAFE.has(entry.method))) {
      const response = await request(route, player.token, 'https://evil.example');
      expect(response).toMatchObject({ status: 403, body: { error: 'origin_not_allowed' } });
    }
    // The profile was not changed by the refused write.
    const me = (await call(api.baseUrl, AccountRoute.Me, { token: player.token })).body as {
      profile: { colorId: string };
    };
    expect(me.profile.colorId).not.toBe('appearance.color.amber');
  });

  it('accepts a recovery-code request with no body or an empty one, never with fields', async () => {
    const player = await signUp();
    const post = (body?: unknown) =>
      call(api.baseUrl, AccountRoute.MyRecoveryCode, {
        method: 'POST',
        origin: ALLOWED_ORIGIN,
        token: player.token,
        ...(body !== undefined ? { body } : {}),
      });
    // JSON content type with an empty body (writes without JSON get 415 earlier).
    const empty = await call(api.baseUrl, AccountRoute.MyRecoveryCode, {
      method: 'POST',
      origin: ALLOWED_ORIGIN,
      token: player.token,
      rawBody: '',
    });
    expect(empty.status).toBe(201);
    expect((await post()).status).toBe(415);
    expect((await post({})).status).toBe(201);
    expect((await post({ extra: 1 })).status).toBe(400);
  });

  it('never takes an account from the request body', async () => {
    const victim = await signUp();
    const attacker = await signUp();
    const victimMe = (await call(api.baseUrl, AccountRoute.Me, { token: victim.token })).body as {
      account: { id: string };
    };
    for (const route of SESSION_ROUTES.filter((entry) => entry.body !== undefined)) {
      const response = await call(api.baseUrl, route.path, {
        method: route.method,
        origin: ALLOWED_ORIGIN,
        token: attacker.token,
        body: { ...(route.body as object), accountId: victimMe.account.id },
      });
      expect({ route: route.path, status: response.status }).toEqual({
        route: route.path,
        status: 400,
      });
    }
  });
});
