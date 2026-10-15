import { describe, expect, it } from 'vitest';
import { generateRecoveryCode, hashRecoveryCode, normalizeRecoveryCode } from './recovery-code';

describe('recovery code', () => {
  it('has 32 unambiguous characters in groups of four', () => {
    const code = generateRecoveryCode();
    expect(code).toMatch(/^([0-9A-HJKMNP-TV-Z]{4}-){7}[0-9A-HJKMNP-TV-Z]{4}$/);
    expect(new Set(Array.from({ length: 50 }, generateRecoveryCode)).size).toBe(50);
  });

  it('accepts the code as people type it', () => {
    expect(normalizeRecoveryCode(' ab0o-1il ')).toBe('AB00111');
    const code = generateRecoveryCode();
    expect(hashRecoveryCode(code.toLowerCase().replace(/-/g, ' '))).toBe(hashRecoveryCode(code));
    expect(hashRecoveryCode(code)).toMatch(/^[0-9a-f]{64}$/);
  });
});
