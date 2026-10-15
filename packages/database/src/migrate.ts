import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import type pg from 'pg';

export const MIGRATIONS_FOLDER = fileURLToPath(new URL('../migrations', import.meta.url));

/** Applies pending migrations in order inside the migrator's transaction. Idempotent. */
export async function runMigrations(pool: pg.Pool): Promise<void> {
  await migrate(drizzle(pool), { migrationsFolder: MIGRATIONS_FOLDER });
}
