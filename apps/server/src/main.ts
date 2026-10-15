import { createDatabase, createPool } from '@orbit/database';
import { createGameServer } from './app';
import { readServerConfig } from './config';
import { DEFAULT_IDENTITY_POLICY, IdentityService } from './modules/identity/identity-service';
import { createArgon2Hasher } from './modules/identity/password-hasher';
import { configureProcessCors } from './transport/http/cors-policy';

const config = readServerConfig();
configureProcessCors({
  allowedOrigins: config.allowedOrigins,
  allowMissingOrigin: config.allowMissingOrigin,
});
const pool = createPool({ connectionString: config.databaseUrl, max: 10 });
const identity = new IdentityService({
  db: createDatabase(pool),
  hasher: createArgon2Hasher({ maxConcurrent: 2, maxQueue: 64 }),
  policy: {
    ...DEFAULT_IDENTITY_POLICY,
    signUpsPerAddress: config.signUpsPerAddress ?? DEFAULT_IDENTITY_POLICY.signUpsPerAddress,
    loginAttemptsPerAddress:
      config.loginAttemptsPerAddress ?? DEFAULT_IDENTITY_POLICY.loginAttemptsPerAddress,
  },
});
const server = createGameServer(config, { identity });
server.onShutdown(() => pool.end());

await server.listen(config.port, config.host);
console.info(`[orbit] servidor ouvindo em ws://${config.host}:${config.port}`);
