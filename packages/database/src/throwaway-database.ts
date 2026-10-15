import { randomInt } from 'node:crypto';
import pg from 'pg';

export interface ThrowawayDatabase {
  readonly name: string;
  /** Connection string pointing at the throwaway database. */
  readonly url: string;
  /** Connection to the server's admin database, kept open until `drop()`. */
  readonly admin: pg.Client;
  drop(): Promise<void>;
}

/**
 * Creates an empty database next to the one in `adminUrl`, for smoke and
 * integration tests. The admin connection is closed if creation fails.
 */
export async function createThrowawayDatabase(
  adminUrl: string,
  prefix: string,
): Promise<ThrowawayDatabase> {
  const name = `${prefix}_${Date.now()}_${process.pid}_${randomInt(1_000_000)}`;
  const admin = new pg.Client({ connectionString: adminUrl, application_name: `${prefix}-admin` });
  await admin.connect();
  try {
    await admin.query(`CREATE DATABASE "${name}"`);
  } catch (error) {
    await admin.end();
    throw error;
  }
  const url = new URL(adminUrl);
  url.pathname = `/${name}`;
  return {
    name,
    url: url.toString(),
    admin,
    async drop() {
      try {
        await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
      } finally {
        await admin.end();
      }
    },
  };
}
