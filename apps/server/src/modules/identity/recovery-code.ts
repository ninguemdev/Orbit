import { createHash, randomBytes } from 'node:crypto';

/** Crockford base32: no I, L, O or U, so the code is easy to read and type. */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** 160 random bits as 32 characters in groups of four, e.g. `7K2D-...`. */
export function generateRecoveryCode(): string {
  const bytes = randomBytes(20);
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  return output.match(/.{4}/g)?.join('-') ?? output;
}

/** Accepts the code as typed: any case, with or without separators, O/I/L read as 0/1/1. */
export function normalizeRecoveryCode(input: string): string {
  return input.toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
}

export function hashRecoveryCode(input: string): string {
  return createHash('sha256').update(normalizeRecoveryCode(input), 'utf8').digest('hex');
}
