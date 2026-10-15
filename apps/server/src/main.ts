import { createDatabase, createPool } from '@orbit/database';
import { createGameServer } from './app';
import { readServerConfig } from './config';
import { IdentityService } from './modules/identity/identity-service';
import { createArgon2Hasher } from './modules/identity/password-hasher';

const config = readServerConfig();
const pool = createPool({ connectionString: config.databaseUrl, max: 10 });
const identity = new IdentityService({
  db: createDatabase(pool),
  hasher: createArgon2Hasher({ maxConcurrent: 2, maxQueue: 64 }),
});
const server = createGameServer(config, { identity });
server.onShutdown(() => pool.end());

await server.listen(config.port, config.host);
console.info(`[orbit] servidor ouvindo em ws://${config.host}:${config.port}`);
