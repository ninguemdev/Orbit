/**
 * Development data: grants a fixed set of items to one account so preparation
 * screens can be exercised, plus the hauler license unless --no-ships. Refused in
 * production. Usage: pnpm db:seed-dev <nick> [--no-ships]
 */
import { ItemId, ShipHullId } from '@orbit/catalog';
import { createDatabase } from '../src/client';
import { findAccountByNick } from '../src/identity/accounts';
import { grantItem, grantShipLicense } from '../src/inventory/inventory';
import { createPool, readDatabaseUrl } from '../src/pool';

const DEV_ITEMS: readonly [string, number][] = [
  [ItemId.Pistol, 1],
  [ItemId.LongRifle, 1],
  [ItemId.RepairKit, 1],
  [ItemId.Medkit, 3],
  [ItemId.Scrap, 20],
  [ItemId.Ore, 10],
];

if (process.env['NODE_ENV'] === 'production') {
  console.error('[seed-dev] recusado: NODE_ENV=production');
  process.exit(1);
}
const args = process.argv.slice(2).filter((arg) => arg !== '--');
const flags = args.filter((arg) => arg.startsWith('--'));
const withShips = !flags.includes('--no-ships');
const nicks = args.filter((arg) => !arg.startsWith('--'));
const nick = nicks[0];
// A mistyped flag must not grant a license nobody asked for.
if (!nick || nicks.length > 1 || flags.some((flag) => flag !== '--no-ships')) {
  console.error('Uso: pnpm db:seed-dev <nick> [--no-ships]');
  process.exit(1);
}

const pool = createPool({ connectionString: readDatabaseUrl(), max: 1 });
try {
  const db = createDatabase(pool);
  const account = await findAccountByNick(db, nick);
  if (!account) {
    console.error(`[seed-dev] conta não encontrada: ${nick}`);
    process.exitCode = 1;
  } else {
    for (const [itemId, quantity] of DEV_ITEMS) {
      await grantItem(db, {
        accountId: account.id,
        itemId,
        quantity,
        origin: 'grant:dev',
        reason: 'dados de desenvolvimento',
      });
    }
    if (withShips) await grantShipLicense(db, account.id, ShipHullId.Hauler, 'grant:dev');
    console.info(
      `[seed-dev] itens de teste${withShips ? ' e licença da Cargueira' : ''} concedidos a ${account.nick}`,
    );
  }
} finally {
  await pool.end();
}
