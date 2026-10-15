export interface ServerConfig {
  readonly port: number;
  readonly host: string;
  readonly allowedOrigins: ReadonlySet<string>;
  /** Non-browser clients (tests, tools) send no Origin header; only accepted outside production. */
  readonly allowMissingOrigin: boolean;
  /** Session cookies require HTTPS unless explicitly disabled for local development. */
  readonly cookieSecure: boolean;
  /** Express 'trust proxy' value: false (direct clients) or the number of proxy hops. */
  readonly trustProxy: false | number;
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
  const cookieSecure = readBoolean(env, 'COOKIE_SECURE', production);
  if (production && !cookieSecure) {
    throw new Error('Cookies sem Secure (COOKIE_SECURE) não são permitidos em produção.');
  }
  const hops = env['TRUST_PROXY'] ?? '0';
  if (!/^\d+$/.test(hops)) throw new Error(`TRUST_PROXY inválido: ${hops}`);
  return {
    port,
    host: env['HOST'] ?? '127.0.0.1',
    allowedOrigins: new Set(origins),
    allowMissingOrigin: !production,
    cookieSecure,
    trustProxy: Number(hops) > 0 ? Number(hops) : false,
    databaseUrl,
  };
}

/** Accepts true/false/1/0 (any case); anything else is a configuration error. */
function readBoolean(env: NodeJS.ProcessEnv, name: string, fallback: boolean): boolean {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = raw.trim().toLowerCase();
  if (value === 'true' || value === '1') return true;
  if (value === 'false' || value === '0') return false;
  throw new Error(`${name} inválido: ${raw} (use true ou false)`);
}
