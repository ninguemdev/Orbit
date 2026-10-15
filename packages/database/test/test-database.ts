import pg from 'pg';
import { type Database, createDatabase } from '../src/client';
import { runMigrations } from '../src/migrate';
import { createPool, readDatabaseUrl } from '../src/pool';

export interface TestDatabase {
  readonly pool: pg.Pool;
  readonly db: Database;
  drop(): Promise<void>;
}

/** Creates an isolated, migrated database for one test file and drops it afterwards. */
export async function createTestDatabase(): Promise<TestDatabase> {
  const adminUrl = readDatabaseUrl();
  const name = `orbit_test_${Date.now()}_${process.pid}_${Math.floor(Math.random() * 1e6)}`;
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`CREATE DATABASE "${name}"`);
  const url = new URL(adminUrl);
  url.pathname = `/${name}`;
  const pool = createPool({ connectionString: url.toString(), max: 8 });
  await runMigrations(pool);
  return {
    pool,
    db: createDatabase(pool),
    async drop() {
      await pool.end();
      await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
      await admin.end();
    },
  };
}

/** A syntactically valid Argon2id hash for tests that do not exercise hashing. */
export const FAKE_ARGON2ID_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHRzb21lc2FsdA$aGFzaGhhc2hoYXNoaGFzaGhhc2hoYXNoaGFzaGhhc2g';
