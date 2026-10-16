import { createDatabase, createPool, updateProfileClass } from '@orbit/database';
import { createGameServer } from './app';
import { errorName } from './infrastructure/error-name';
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
server.onShutdown(async () => {
  // Rooms are gone by now; their cancellations finish before the pool closes.
  await expeditions.close();
  await pool.end();
});

await server.listen(config.port, config.host);
console.info(`[orbit] servidor ouvindo em ws://${config.host}:${config.port}`);

/**
 * Single process: a preparation left by the previous run has no room and is cancelled
 * at its deadline, which returns its items (docs/12). Until that happens its members
 * are refused as already in an expedition, so a database outage only delays it.
 */
async function recoverPreparations(attempt = 0): Promise<void> {
  try {
    const pending = await expeditions.recoverPreparations();
    if (pending > 0) console.info(`[orbit] ${pending} preparação(ões) anterior(es) a cancelar`);
  } catch (error) {
    console.error(`[orbit] recuperação de preparações falhou: ${errorName(error)}`);
    const delay = Math.min(60_000, 2000 * 2 ** attempt);
    setTimeout(() => void recoverPreparations(attempt + 1), delay).unref();
  }
}
void recoverPreparations();
