import { describe, expect, it } from 'vitest';
import {
  ErrorCode,
  PROTOCOL_VERSION,
  parseCrewInput,
  parseEmptyPayload,
  parseJoinOptions,
  parseShipInput,
} from './protocol';

describe('crew.input', () => {
  it('accepts a sequenced direction', () => {
    expect(parseCrewInput({ seq: 3, x: -1, y: 0.5 })).toEqual({
      ok: true,
      value: { seq: 3, x: -1, y: 0.5 },
    });
  });

  it.each([
    ['NaN axis', { seq: 1, x: Number.NaN, y: 0 }],
    ['infinite axis', { seq: 1, x: Infinity, y: 0 }],
    ['axis out of range', { seq: 1, x: 2, y: 0 }],
    ['negative sequence', { seq: -1, x: 0, y: 0 }],
    ['fractional sequence', { seq: 1.5, x: 0, y: 0 }],
    ['string axis', { seq: 1, x: '1', y: 0 }],
    ['client-supplied position', { seq: 1, x: 0, y: 0, posX: 500, posY: 500 }],
    ['missing field', { seq: 1, x: 0 }],
    ['not an object', 42],
  ])('rejects %s', (_label, payload) => {
    expect(parseCrewInput(payload)).toEqual({ ok: false, code: ErrorCode.InvalidPayload });
  });
});

describe('ship.input', () => {
  it('accepts thrust and turn within limits only', () => {
    expect(parseShipInput({ seq: 0, thrust: 1, turn: -1 }).ok).toBe(true);
    expect(parseShipInput({ seq: 0, thrust: 4, turn: 0 }).ok).toBe(false);
    expect(parseShipInput({ seq: 0, thrust: 1, turn: 0, x: 1, y: 1 }).ok).toBe(false);
  });
});

describe('empty payloads and join options', () => {
  it('accepts only undefined or an empty object for payload-less messages', () => {
    expect(parseEmptyPayload(undefined).ok).toBe(true);
    expect(parseEmptyPayload({}).ok).toBe(true);
    expect(parseEmptyPayload({ force: true }).ok).toBe(false);
  });

  it('requires the current protocol version and a safe display name', () => {
    expect(parseJoinOptions({ protocolVersion: PROTOCOL_VERSION, name: 'Ana_01' }).ok).toBe(true);
    expect(parseJoinOptions({ protocolVersion: PROTOCOL_VERSION + 1 })).toEqual({
      ok: false,
      code: ErrorCode.ProtocolMismatch,
    });
    expect(parseJoinOptions({ protocolVersion: PROTOCOL_VERSION, name: '<script>' })).toEqual({
      ok: false,
      code: ErrorCode.InvalidPayload,
    });
  });
});
