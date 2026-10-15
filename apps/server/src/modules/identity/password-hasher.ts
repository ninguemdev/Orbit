import { randomBytes } from 'node:crypto';
import { type Options, hash, verify } from '@node-rs/argon2';
import { Semaphore } from '../../infrastructure/semaphore';

export interface PasswordHasher {
  hash(password: string): Promise<string>;
  verify(passwordHash: string, password: string): Promise<boolean>;
  /** Spends the same work as a real verification, for unknown accounts. */
  verifyDummy(password: string): Promise<void>;
  /** Highest number of concurrent hashing operations observed. */
  readonly peakConcurrency: number;
}

/** OWASP baseline for Argon2id: 19 MiB, 2 iterations, parallelism 1. */
export const ARGON2ID_OPTIONS: Options = {
  // Algorithm.Argon2id; the package exposes it as an ambient const enum.
  algorithm: 2,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
};

export interface HasherLimits {
  /** Concurrent hashes; each one holds ~19 MiB and a CPU core for tens of ms. */
  readonly maxConcurrent: number;
  readonly maxQueue: number;
}

export function createArgon2Hasher(limits: HasherLimits): PasswordHasher {
  const semaphore = new Semaphore({ max: limits.maxConcurrent, maxQueue: limits.maxQueue });
  let dummyHash: Promise<string> | undefined;
  const hasher: PasswordHasher = {
    hash: (password) => semaphore.run(() => hash(password, ARGON2ID_OPTIONS)),
    verify: (passwordHash, password) =>
      semaphore.run(async () => {
        try {
          return await verify(passwordHash, password);
        } catch {
          return false; // Malformed stored hash never authenticates.
        }
      }),
    async verifyDummy(password) {
      dummyHash ??= hasher.hash(randomBytes(32).toString('base64url'));
      await hasher.verify(await dummyHash, password);
    },
    get peakConcurrency() {
      return semaphore.peak;
    },
  };
  return hasher;
}
