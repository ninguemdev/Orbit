import type pg from 'pg';
import { type Database, createDatabase } from '../src/client';
import { runMigrations } from '../src/migrate';
import { createPool, readDatabaseUrl } from '../src/pool';
import { createThrowawayDatabase } from '../src/throwaway-database';

export interface TestDatabase {
  readonly pool: pg.Pool;
  readonly db: Database;
  drop(): Promise<void>;
}

/** Creates an isolated, migrated database for one test file; cleans up if setup fails. */
export async function createTestDatabase(): Promise<TestDatabase> {
  const throwaway = await createThrowawayDatabase(readDatabaseUrl(), 'orbit_test');
  const pool = createPool({ connectionString: throwaway.url, max: 8 });
  const drop = async () => {
    try {
      await pool.end();
    } finally {
      await throwaway.drop();
    }
  };
  try {
    await runMigrations(pool);
  } catch (error) {
    await drop();
    throw error;
  }
  return { pool, db: createDatabase(pool), drop };
}

/** A syntactically valid Argon2id hash for tests that do not exercise hashing. */
export const FAKE_ARGON2ID_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHRzb21lc2FsdA$aGFzaGhhc2hoYXNoaGFzaGhhc2hoYXNoaGFzaGhhc2g';
