import { createDatabase, createPool, updateProfileClass } from '@orbit/database';
import { createGameServer } from './app';
import { ExpeditionService } from './modules/expedition/expedition-service';
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
const db = createDatabase(pool);
const identity = new IdentityService({
  db,
  hasher: createArgon2Hasher({ maxConcurrent: 2, maxQueue: 64 }),
  policy: {
    ...DEFAULT_IDENTITY_POLICY,
    signUpsPerAddress: config.signUpsPerAddress ?? DEFAULT_IDENTITY_POLICY.signUpsPerAddress,
    loginAttemptsPerAddress:
      config.loginAttemptsPerAddress ?? DEFAULT_IDENTITY_POLICY.loginAttemptsPerAddress,
  },
});
const expeditions = new ExpeditionService(db);
const server = createGameServer(config, {
  identity,
  db,
  expeditions,
  classPreferences: { save: (accountId, classId) => updateProfileClass(db, accountId, classId) },
  ...(config.partyCodeGuessesPerAddress !== undefined
    ? { codeGuessesPerAddress: config.partyCodeGuessesPerAddress }
    : {}),
});
server.onShutdown(() => {
  expeditions.close();
  return pool.end();
});

// Single process: a preparation left by the previous run has no room and is cancelled
// at its deadline, which returns its items (docs/12).
const pending = await expeditions.recoverPreparations();
if (pending > 0) console.info(`[orbit] ${pending} preparação(ões) pendente(s) serão canceladas`);
await server.listen(config.port, config.host);
console.info(`[orbit] servidor ouvindo em ws://${config.host}:${config.port}`);
