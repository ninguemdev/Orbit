export interface ServerConfig {
  readonly port: number;
  readonly host: string;
  readonly allowedOrigins: ReadonlySet<string>;
  /** Non-browser clients (tests, tools) send no Origin header; only accepted outside production. */
  readonly allowMissingOrigin: boolean;
  /** Session cookies require HTTPS unless explicitly disabled for local development. */
  readonly cookieSecure: boolean;
}

export interface ServerEnvironment extends ServerConfig {
  readonly databaseUrl: string;
}

const DEFAULT_ORIGINS = 'http://localhost:5173,http://127.0.0.1:5173';

export function readServerConfig(env: NodeJS.ProcessEnv = process.env): ServerEnvironment {
  const port = Number(env['PORT'] ?? 2567);
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new Error(`PORT inválida: ${env['PORT']}`);
  }
  const databaseUrl = env['DATABASE_URL'];
  if (!databaseUrl) throw new Error('DATABASE_URL não definida (veja .env.example).');
  const origins = (env['ALLOWED_ORIGINS'] ?? DEFAULT_ORIGINS)
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  const production = env['NODE_ENV'] === 'production';
  const cookieSecure =
    env['COOKIE_SECURE'] === undefined ? production : env['COOKIE_SECURE'] === 'true';
  if (production && !cookieSecure)
    throw new Error('COOKIE_SECURE=false não é permitido em produção.');
  return {
    port,
    host: env['HOST'] ?? '127.0.0.1',
    allowedOrigins: new Set(origins),
    allowMissingOrigin: !production,
    cookieSecure,
    databaseUrl,
  };
}
