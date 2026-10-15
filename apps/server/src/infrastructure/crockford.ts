import { randomInt } from 'node:crypto';

/** Crockford base32: no I, L, O or U, so codes are easy to read aloud and type. */
export const CROCKFORD_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** Accepts a code as typed: any case, spaces or dashes, O/I/L read as 0/1/1. */
export function normalizeCrockford(input: string): string {
  return input.toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
}

export function randomCrockford(length: number): string {
  let code = '';
  for (let i = 0; i < length; i++) code += CROCKFORD_ALPHABET[randomInt(CROCKFORD_ALPHABET.length)];
  return code;
}
