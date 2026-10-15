export interface ServerConfig {
  readonly port: number;
  readonly host: string;
  readonly allowedOrigins: ReadonlySet<string>;
  /** Non-browser clients (tests, tools) send no Origin header; only accepted outside production. */
  readonly allowMissingOrigin: boolean;
}

const DEFAULT_ORIGINS = 'http://localhost:5173,http://127.0.0.1:5173';

export function readServerConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const port = Number(env['PORT'] ?? 2567);
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new Error(`PORT inválida: ${env['PORT']}`);
  }
  const origins = (env['ALLOWED_ORIGINS'] ?? DEFAULT_ORIGINS)
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  return {
    port,
    host: env['HOST'] ?? '127.0.0.1',
    allowedOrigins: new Set(origins),
    allowMissingOrigin: env['NODE_ENV'] !== 'production',
  };
}
