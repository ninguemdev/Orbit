import pg from 'pg';

export interface PoolOptions {
  readonly connectionString: string;
  /** Upper bound of open connections; keep small, the game loop never queries per tick. */
  readonly max?: number;
}

export function createPool({ connectionString, max = 10 }: PoolOptions): pg.Pool {
  const pool = new pg.Pool({
    connectionString,
    max,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 5_000,
    application_name: 'orbit',
  });
  // An idle client error must not crash the process; the pool discards that client.
  pool.on('error', (error) => console.error('[database] erro em conexão ociosa:', error.message));
  return pool;
}

export function readDatabaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const url = env['DATABASE_URL'];
  if (!url) throw new Error('DATABASE_URL não definida (veja .env.example).');
  return url;
}
