import { describe, expect, it } from 'vitest';
import { ErrorCode, PROTOCOL_VERSION } from '@orbit/contracts';
import { decideJoin, isOriginAllowed } from './access-policy';

const dev = { allowedOrigins: new Set(['http://localhost:5173']), allowMissingOrigin: true };
const production = { ...dev, allowMissingOrigin: false };

describe('access policy', () => {
  it('accepts only allow-listed origins', () => {
    expect(isOriginAllowed(dev, 'http://localhost:5173')).toBe(true);
    expect(isOriginAllowed(dev, 'http://localhost:5174')).toBe(false);
  });

  it('accepts a missing Origin only outside production', () => {
    expect(isOriginAllowed(dev, null)).toBe(true);
    expect(isOriginAllowed(production, null)).toBe(false);
  });

  it('checks origin before join options', () => {
    expect(decideJoin(dev, 'http://evil.example', { protocolVersion: PROTOCOL_VERSION })).toEqual({
      ok: false,
      code: ErrorCode.OriginNotAllowed,
    });
    expect(decideJoin(dev, null, { protocolVersion: 0 })).toEqual({
      ok: false,
      code: ErrorCode.ProtocolMismatch,
    });
    expect(decideJoin(dev, null, { protocolVersion: PROTOCOL_VERSION, name: 'Ana' }).ok).toBe(true);
  });
});
