import { createHash } from 'node:crypto';
import { normalizeCrockford, randomCrockford } from '../../infrastructure/crockford';

/** 160 random bits as 32 Crockford characters in groups of four, e.g. `7K2D-...`. */
export function generateRecoveryCode(): string {
  const code = randomCrockford(32);
  return code.match(/.{4}/g)?.join('-') ?? code;
}

/** Accepts the code as typed: any case, with or without separators, O/I/L read as 0/1/1. */
export function normalizeRecoveryCode(input: string): string {
  return normalizeCrockford(input);
}

export function hashRecoveryCode(input: string): string {
  return createHash('sha256').update(normalizeRecoveryCode(input), 'utf8').digest('hex');
}
