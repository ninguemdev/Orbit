import { describe, expect, it } from 'vitest';
import { readServerConfig } from './config';

const base = { DATABASE_URL: 'postgres://u:p@127.0.0.1/db' };

describe('readServerConfig', () => {
  it('requires a database', () => {
    expect(() => readServerConfig({})).toThrow(/DATABASE_URL/);
  });

  it('defaults Secure cookies to production and refuses insecure ones there', () => {
    expect(readServerConfig(base).cookieSecure).toBe(false);
    expect(readServerConfig({ ...base, NODE_ENV: 'production' }).cookieSecure).toBe(true);
    expect(() => readServerConfig({ ...base, NODE_ENV: 'production', COOKIE_SECURE: '0' })).toThrow(
      /Secure/,
    );
  });

  it('accepts only explicit boolean values for COOKIE_SECURE', () => {
    expect(readServerConfig({ ...base, COOKIE_SECURE: 'TRUE' }).cookieSecure).toBe(true);
    expect(readServerConfig({ ...base, COOKIE_SECURE: '1' }).cookieSecure).toBe(true);
    expect(() => readServerConfig({ ...base, COOKIE_SECURE: 'yes' })).toThrow(/COOKIE_SECURE/);
  });

  it('reads optional per-address limits', () => {
    expect(readServerConfig(base).signUpsPerAddress).toBeUndefined();
    expect(readServerConfig({ ...base, SIGNUPS_PER_ADDRESS: '50' }).signUpsPerAddress).toBe(50);
    expect(
      readServerConfig({ ...base, PARTY_CODE_GUESSES_PER_ADDRESS: '7' }).partyCodeGuessesPerAddress,
    ).toBe(7);
    expect(readServerConfig(base).partyCodeGuessesPerAddress).toBeUndefined();
    expect(() => readServerConfig({ ...base, LOGIN_ATTEMPTS_PER_ADDRESS: '0' })).toThrow(
      /LOGIN_ATTEMPTS_PER_ADDRESS/,
    );
  });

  it('reads the number of trusted proxy hops', () => {
    expect(readServerConfig(base).trustProxy).toBe(false);
    expect(readServerConfig({ ...base, TRUST_PROXY: '1' }).trustProxy).toBe(1);
    expect(() => readServerConfig({ ...base, TRUST_PROXY: 'true' })).toThrow(/TRUST_PROXY/);
  });
});
