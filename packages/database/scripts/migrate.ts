import { createPool, readDatabaseUrl } from '../src/pool';
import { runMigrations } from '../src/migrate';

const pool = createPool({ connectionString: readDatabaseUrl(), max: 1 });
try {
  await runMigrations(pool);
  console.info('[database] migrações aplicadas');
} finally {
  await pool.end();
}
