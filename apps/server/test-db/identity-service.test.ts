import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createDatabase,
  createPool,
  createThrowawayDatabase,
  readDatabaseUrl,
  runMigrations,
  type ThrowawayDatabase,
} from '@orbit/database';
import type pg from 'pg';
import { DEFAULT_IDENTITY_POLICY, IdentityService } from '../src/modules/identity/identity-service';
import type { PasswordHasher } from '../src/modules/identity/password-hasher';

/** Deterministic, instant hasher: these tests are about limits and sessions, not Argon2. */
const fakeHasher: PasswordHasher = {
  hash: async (password) => `$argon2id$fake$${password}`,
  verify: async (passwordHash, password) => passwordHash === `$argon2id$fake$${password}`,
  verifyDummy: async () => undefined,
  peakConcurrency: 0,
};

describe('IdentityService limits and session lifetime', () => {
  let throwaway: ThrowawayDatabase;
  let pool: pg.Pool;
  // Starts at the real time, not a fixed date: the database still stamps created_at on
  // its own clock, and a session issued from a stale mocked "now" would already expire
  // before it was created (sessions_expires_after_creation) once that date is past.
  let now = new Date();
  let service: IdentityService;

  beforeAll(async () => {
    throwaway = await createThrowawayDatabase(readDatabaseUrl(), 'orbit_identity_test');
    pool = createPool({ connectionString: throwaway.url, max: 4 });
    await runMigrations(pool);
    service = new IdentityService({
      db: createDatabase(pool),
      hasher: fakeHasher,
      now: () => now,
      policy: {
        ...DEFAULT_IDENTITY_POLICY,
        loginAttemptsPerAddress: 3,
        signUpsPerAddress: 2,
        limitWindowMs: 60_000,
      },
    });
  });

  afterAll(async () => {
    await pool?.end();
    await throwaway?.drop();
  });

  it('limits sign-ups per address', async () => {
    const credentials = (nick: string) => ({ nick, password: 'senha suficientemente longa' });
    expect((await service.signUp(credentials('Lim_1'), '10.0.0.1')).ok).toBe(true);
    expect((await service.signUp(credentials('Lim_2'), '10.0.0.1')).ok).toBe(true);
    expect(await service.signUp(credentials('Lim_3'), '10.0.0.1')).toEqual({
      ok: false,
      code: 'rate_limited',
    });
    expect((await service.signUp(credentials('Lim_3'), '10.0.0.2')).ok).toBe(true);
  });

  it('limits login attempts per address, then recovers after the window', async () => {
    const attempt = () =>
      service.login({ nick: 'Lim_1', password: 'senha suficientemente longa' }, '10.0.0.9');
    for (let i = 0; i < 3; i++) expect((await attempt()).ok).toBe(true);
    expect(await attempt()).toEqual({ ok: false, code: 'rate_limited' });
    now = new Date(now.getTime() + 61_000);
    expect((await attempt()).ok).toBe(true);
  });

  it('limits recovery attempts per address', async () => {
    const attempt = () =>
      service.recover(
        { nick: 'Lim_2', code: 'AAAA-BBBB', newPassword: 'senha nova muito longa' },
        '10.0.0.20',
      );
    for (let i = 0; i < 3; i++)
      expect(await attempt()).toEqual({ ok: false, code: 'invalid_recovery' });
    expect(await attempt()).toEqual({ ok: false, code: 'rate_limited' });
  });

  it('expires sessions after the configured lifetime', async () => {
    const signedIn = await service.login(
      { nick: 'Lim_2', password: 'senha suficientemente longa' },
      '10.0.0.10',
    );
    if (!signedIn.ok) throw new Error('login falhou');
    expect(await service.authenticate(signedIn.session.token)).not.toBeNull();
    now = new Date(now.getTime() + DEFAULT_IDENTITY_POLICY.sessionTtlMs + 1);
    expect(await service.authenticate(signedIn.session.token)).toBeNull();
  });
});
