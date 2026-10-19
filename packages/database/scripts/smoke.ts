/**
 * Migration smoke: creates a throwaway database, applies every migration to the
 * empty database twice (idempotence), checks the schema, closes the pool and
 * verifies that no connection was left open, then drops the database.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { MIGRATIONS_FOLDER, runMigrations } from '../src/migrate';
import { createPool, readDatabaseUrl } from '../src/pool';
import { createThrowawayDatabase } from '../src/throwaway-database';

const journal = JSON.parse(
  readFileSync(join(MIGRATIONS_FOLDER, 'meta', '_journal.json'), 'utf8'),
) as {
  entries: unknown[];
};

const throwaway = await createThrowawayDatabase(readDatabaseUrl(), 'orbit_smoke');
const { admin, name: databaseName } = throwaway;

try {
  const pool = createPool({ connectionString: throwaway.url, max: 2 });

  await runMigrations(pool);
  await runMigrations(pool);

  const tables = await pool.query<{ table_name: string }>(
    `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY 1`,
  );
  assert.deepEqual(
    tables.rows.map((row) => row.table_name),
    [
      'account_recovery',
      'accounts',
      'active_participations',
      'app_metadata',
      'expedition_members',
      'expeditions',
      'inbox_entries',
      'inventory_slots',
      'item_instances',
      'item_reservations',
      'loadout_items',
      'profiles',
      'sessions',
      'settlements',
      'ship_unlocks',
      'wallets',
    ],
  );
  const applied = await pool.query<{ count: number }>(
    'SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations',
  );
  assert.equal(applied.rows[0]?.count, journal.entries.length, 'cada migração aplicada uma vez');

  await pool.query(`INSERT INTO app_metadata (key, value) VALUES ('smoke', 'ok')`);
  const roundTrip = await pool.query<{ value: string }>(
    `SELECT value FROM app_metadata WHERE key = 'smoke'`,
  );
  assert.equal(roundTrip.rows[0]?.value, 'ok');

  await pool.end();
  assert.equal(pool.totalCount, 0, 'pool sem conexões após end()');

  // The server may take a moment to reap backends after the clients disconnect.
  let open = -1;
  for (let attempt = 0; attempt < 20 && open !== 0; attempt++) {
    const activity = await admin.query<{ count: number }>(
      'SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname = $1',
      [databaseName],
    );
    open = activity.rows[0]?.count ?? -1;
    if (open !== 0) await sleep(100);
  }
  assert.equal(open, 0, 'nenhuma conexão aberta no banco de teste');

  console.info(
    `[database] smoke ok: ${journal.entries.length} migração(ões) em banco vazio, reaplicação idempotente, conexões encerradas`,
  );
} finally {
  await throwaway.drop();
}
