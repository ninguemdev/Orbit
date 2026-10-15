import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import type pg from 'pg';
import * as schema from './schema';

export type Database = NodePgDatabase<typeof schema>;

export function createDatabase(pool: pg.Pool): Database {
  return drizzle(pool, { schema });
}

/** PostgreSQL error fields we rely on; Drizzle wraps driver errors in `cause`. */
interface PgErrorFields {
  readonly code?: string;
  readonly constraint?: string;
}

export function postgresError(error: unknown): PgErrorFields | null {
  for (let current = error, depth = 0; current && depth < 3; depth++) {
    const fields = current as PgErrorFields & { cause?: unknown };
    if (typeof fields.code === 'string') return fields;
    current = fields.cause;
  }
  return null;
}

export function isUniqueViolation(error: unknown, constraint: string): boolean {
  const pgError = postgresError(error);
  return pgError?.code === '23505' && pgError.constraint === constraint;
}
