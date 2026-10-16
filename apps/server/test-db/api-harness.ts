import type { AddressInfo } from 'node:net';
import type { Server } from '@colyseus/core';
import { SESSION_COOKIE } from '@orbit/contracts';
import {
  type Database,
  createDatabase,
  createPool,
  createThrowawayDatabase,
  readDatabaseUrl,
  runMigrations,
  updateProfileClass,
} from '@orbit/database';
import type pg from 'pg';
import { type GameServices, createGameServer } from '../src/app';
import { ExpeditionService } from '../src/modules/expedition/expedition-service';
import { type IdentityPolicy, IdentityService } from '../src/modules/identity/identity-service';
import { type PasswordHasher, createArgon2Hasher } from '../src/modules/identity/password-hasher';
import { configureProcessCors } from '../src/transport/http/cors-policy';

export const ALLOWED_ORIGIN = 'http://localhost:5173';

export interface ApiServer {
  readonly baseUrl: string;
  readonly expeditions: ExpeditionService;
  readonly pool: pg.Pool;
  readonly db: Database;
  readonly hasher: PasswordHasher;
  close(): Promise<void>;
}

/** Real server + real Argon2id + throwaway PostgreSQL database. */
/** `services` replaces the default ports (e.g. a class store that fails on purpose). */
export async function startApiServer(
  policy: IdentityPolicy,
  services: Partial<GameServices> = {},
  options: { readonly prepareSeconds?: number } = {},
): Promise<ApiServer> {
  const throwaway = await createThrowawayDatabase(readDatabaseUrl(), 'orbit_api_test');
  const pool = createPool({ connectionString: throwaway.url, max: 8 });
  let server: Server | undefined;
  let expeditions: ExpeditionService | undefined;
  const close = async () => {
    try {
      expeditions?.close();
      await server?.gracefullyShutdown(false);
      await pool.end();
    } finally {
      await throwaway.drop();
    }
  };
  try {
    await runMigrations(pool);
    const db = createDatabase(pool);
    expeditions = new ExpeditionService(db, options);
    const hasher = createArgon2Hasher({ maxConcurrent: 2, maxQueue: 64 });
    const allowedOrigins = new Set([ALLOWED_ORIGIN]);
    configureProcessCors({ allowedOrigins, allowMissingOrigin: true });
    server = createGameServer(
      {
        host: '127.0.0.1',
        port: 0,
        allowedOrigins,
        allowMissingOrigin: true,
        cookieSecure: false,
        trustProxy: false,
      },
      {
        identity: new IdentityService({ db, hasher, policy }),
        db,
        // Every test shares 127.0.0.1; the limit itself is covered by a unit test.
        codeGuessesPerAddress: 1000,
        classPreferences: {
          save: (accountId, classId) => updateProfileClass(db, accountId, classId),
        },
        expeditions,
        ...services,
      },
    );
    await server.listen(0, '127.0.0.1');
    const address = server.transport.server?.address() as AddressInfo;
    return { baseUrl: `http://127.0.0.1:${address.port}`, expeditions, pool, db, hasher, close };
  } catch (error) {
    await close();
    throw error;
  }
}

export interface ApiResponse {
  readonly status: number;
  readonly body: unknown;
  readonly headers: Headers;
  /** Session token from Set-Cookie, `''` when the cookie was cleared, undefined if absent. */
  readonly token: string | undefined;
}

export interface ApiRequest {
  readonly method?: string;
  readonly body?: unknown;
  readonly token?: string;
  readonly origin?: string;
  readonly contentType?: string;
  readonly rawBody?: string;
}

export async function call(
  base: string,
  path: string,
  request: ApiRequest = {},
): Promise<ApiResponse> {
  const headers: Record<string, string> = {};
  if (request.token !== undefined) headers['cookie'] = `${SESSION_COOKIE}=${request.token}`;
  if (request.origin) headers['origin'] = request.origin;
  const hasBody = request.body !== undefined || request.rawBody !== undefined;
  if (hasBody) headers['content-type'] = request.contentType ?? 'application/json';
  const response = await fetch(base + path, {
    method: request.method ?? 'GET',
    headers,
    ...(hasBody ? { body: request.rawBody ?? JSON.stringify(request.body) } : {}),
  });
  const text = await response.text();
  const setCookie = response.headers.get('set-cookie');
  const match = setCookie ? new RegExp(`${SESSION_COOKIE}=([^;]*)`).exec(setCookie) : null;
  return {
    status: response.status,
    body: text ? (JSON.parse(text) as unknown) : null,
    headers: response.headers,
    token: match ? match[1] : undefined,
  };
}
