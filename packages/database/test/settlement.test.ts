import { createHash, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ClassId, DEFAULT_APPEARANCE_COLOR, ItemId, ShipHullId } from '@orbit/catalog';
import {
  type StartExpeditionRequest,
  activateExpedition,
  startExpedition,
} from '../src/expedition/expeditions';
import { type SettlementManifest, settleExpedition } from '../src/expedition/settlement';
import { createAccount } from '../src/identity/accounts';
import { updateProfileClass } from '../src/identity/sessions';
import { getInventory, grantItem } from '../src/inventory/inventory';
import { type LoadoutPick, setLoadout } from '../src/inventory/loadout';
import { FAKE_ARGON2ID_HASH, type TestDatabase, createTestDatabase } from './test-database';

const hashOf = (label: string) => createHash('sha256').update(label).digest('hex');

describe('settleExpedition', () => {
  let t: TestDatabase;
  let counter = 0;

  beforeAll(async () => {
    t = await createTestDatabase();
  });

  afterAll(async () => {
    await t?.drop();
  });

  interface Player {
    readonly accountId: string;
    readonly instanceId: string;
  }

  /** An account with one reserved pistol, ready to join an expedition. */
  async function newPlayer(): Promise<Player> {
    const created = await createAccount(t.db, {
      nick: `Settle_${++counter}`,
      passwordHash: FAKE_ARGON2ID_HASH,
      colorId: DEFAULT_APPEARANCE_COLOR,
    });
    if (!created.ok) throw new Error('conta não criada');
    const { accountId } = created;
    await updateProfileClass(t.db, accountId, ClassId.Officer);
    await grantItem(t.db, {
      accountId,
      itemId: ItemId.Pistol,
      quantity: 1,
      origin: 'grant:test',
      reason: 'teste',
    });
    const [pistol] = (await getInventory(t.db, accountId)).stash;
    if (!pistol) throw new Error('item não concedido');
    const loadout: LoadoutPick[] = [{ slot: 'sidearm', instanceId: pistol.instanceId }];
    expect(await setLoadout(t.db, accountId, loadout)).toEqual({ ok: true });
    return { accountId, instanceId: pistol.instanceId };
  }

  /** Starts and activates an expedition for the given players. */
  async function activeExpedition(players: readonly Player[]): Promise<string> {
    const request: StartExpeditionRequest = {
      startKey: randomUUID(),
      leaderAccountId: players[0]?.accountId ?? '',
      shipId: ShipHullId.Scout,
      members: players.map((player) => ({
        accountId: player.accountId,
        classId: ClassId.Officer,
        loadout: [{ slot: 'sidearm', instanceId: player.instanceId }],
      })),
    };
    const started = await startExpedition(t.db, request);
    if (!started.ok) throw new Error(started.reason);
    expect(await activateExpedition(t.db, started.expeditionId)).toBe('activated');
    return started.expeditionId;
  }

  async function finalStatesOf(expeditionId: string): Promise<Record<string, string | null>> {
    const rows = await t.pool.query<{ account_id: string; final_state: string | null }>(
      'SELECT account_id, final_state FROM expedition_members WHERE expedition_id = $1',
      [expeditionId],
    );
    return Object.fromEntries(rows.rows.map((row) => [row.account_id, row.final_state]));
  }

  async function stateOf(expeditionId: string): Promise<string> {
    const rows = await t.pool.query<{ state: string }>(
      'SELECT state FROM expeditions WHERE id = $1',
      [expeditionId],
    );
    return rows.rows[0]?.state ?? '';
  }

  it('returns personal gear to every eligible member and grants divided common loot', async () => {
    const a = await newPlayer();
    const b = await newPlayer();
    const expeditionId = await activeExpedition([a, b]);

    const manifest: SettlementManifest = {
      expeditionId,
      outcome: 'extracted',
      eligibleAccountIds: [a.accountId, b.accountId],
      destinations: [
        {
          sourceId: a.instanceId,
          accountId: a.accountId,
          itemId: ItemId.Pistol,
          quantity: 1,
          origin: 'loadout',
        },
        {
          sourceId: b.instanceId,
          accountId: b.accountId,
          itemId: ItemId.Pistol,
          quantity: 1,
          origin: 'loadout',
        },
        {
          sourceId: 'loot_1',
          accountId: a.accountId,
          itemId: ItemId.Ore,
          quantity: 3,
          origin: 'container.1',
        },
        {
          sourceId: 'loot_1',
          accountId: b.accountId,
          itemId: ItemId.Ore,
          quantity: 2,
          origin: 'container.1',
        },
      ],
      losses: [],
    };

    const result = await settleExpedition(t.db, manifest, hashOf('m1'));
    expect(result).toEqual({ ok: true });
    expect(await stateOf(expeditionId)).toBe('CLOSED');
    expect(await finalStatesOf(expeditionId)).toEqual({
      [a.accountId]: 'extracted',
      [b.accountId]: 'extracted',
    });
    expect(await count('item_reservations', expeditionId, t)).toBe(0);
    expect(await count('active_participations', expeditionId, t)).toBe(0);

    const stashA = (await getInventory(t.db, a.accountId)).stash;
    expect(stashA.find((entry) => entry.instanceId === a.instanceId)?.reserved).toBe(false);
    const oreA = stashA.find((entry) => entry.itemId === ItemId.Ore);
    const oreB = (await getInventory(t.db, b.accountId)).stash.find(
      (entry) => entry.itemId === ItemId.Ore,
    );
    expect(oreA?.quantity).toBe(3);
    expect(oreB?.quantity).toBe(2);
  });

  it('destroys the personal gear of a member who was not eligible, without handing it to anyone else', async () => {
    const a = await newPlayer();
    const b = await newPlayer();
    const expeditionId = await activeExpedition([a, b]);

    const manifest: SettlementManifest = {
      expeditionId,
      outcome: 'extracted',
      eligibleAccountIds: [a.accountId],
      destinations: [
        {
          sourceId: a.instanceId,
          accountId: a.accountId,
          itemId: ItemId.Pistol,
          quantity: 1,
          origin: 'loadout',
        },
      ],
      losses: [
        {
          sourceId: b.instanceId,
          accountId: b.accountId,
          itemId: ItemId.Pistol,
          quantity: 1,
          origin: 'loadout',
          reason: 'not_eligible',
        },
      ],
    };

    expect(await settleExpedition(t.db, manifest, hashOf('m2'))).toEqual({ ok: true });
    expect(await finalStatesOf(expeditionId)).toEqual({
      [a.accountId]: 'extracted',
      [b.accountId]: 'not_eligible',
    });
    const stashB = (await getInventory(t.db, b.accountId)).stash;
    expect(stashB.find((entry) => entry.instanceId === b.instanceId)).toBeUndefined();
    const stashA = (await getInventory(t.db, a.accountId)).stash;
    expect(stashA.find((entry) => entry.instanceId === a.instanceId)).toBeDefined();
  });

  for (const outcome of ['destroyed', 'timeout'] as const) {
    it(`loses every personal item and grants nothing on ${outcome}`, async () => {
      const a = await newPlayer();
      const expeditionId = await activeExpedition([a]);

      const manifest: SettlementManifest = {
        expeditionId,
        outcome,
        eligibleAccountIds: [],
        destinations: [],
        losses: [
          {
            sourceId: a.instanceId,
            accountId: a.accountId,
            itemId: ItemId.Pistol,
            quantity: 1,
            origin: 'loadout',
            reason: 'mission_failed',
          },
        ],
      };

      expect(await settleExpedition(t.db, manifest, hashOf(`fail-${outcome}`))).toEqual({
        ok: true,
      });
      expect(await stateOf(expeditionId)).toBe('FAILED');
      expect(await finalStatesOf(expeditionId)).toEqual({ [a.accountId]: outcome });
      const stash = (await getInventory(t.db, a.accountId)).stash;
      expect(stash.find((entry) => entry.instanceId === a.instanceId)).toBeUndefined();
    });
  }

  it('settling the same expedition again with the same manifest grants nothing twice', async () => {
    const a = await newPlayer();
    const expeditionId = await activeExpedition([a]);
    const manifest: SettlementManifest = {
      expeditionId,
      outcome: 'extracted',
      eligibleAccountIds: [a.accountId],
      destinations: [
        {
          sourceId: 'loot_1',
          accountId: a.accountId,
          itemId: ItemId.Ore,
          quantity: 4,
          origin: 'container.1',
        },
      ],
      losses: [],
    };
    const hash = hashOf('retry');

    expect(await settleExpedition(t.db, manifest, hash)).toEqual({ ok: true });
    expect(await settleExpedition(t.db, manifest, hash)).toEqual({ ok: true });
    expect(await settleExpedition(t.db, manifest, hash)).toEqual({ ok: true });

    const ore = (await getInventory(t.db, a.accountId)).stash.find(
      (entry) => entry.itemId === ItemId.Ore,
    );
    expect(ore?.quantity).toBe(4);
    expect(await count('settlements', expeditionId, t, 'expedition_id')).toBe(1);
  });

  it('refuses a different manifest for an already settled expedition', async () => {
    const a = await newPlayer();
    const expeditionId = await activeExpedition([a]);
    const manifest: SettlementManifest = {
      expeditionId,
      outcome: 'extracted',
      eligibleAccountIds: [a.accountId],
      destinations: [
        {
          sourceId: a.instanceId,
          accountId: a.accountId,
          itemId: ItemId.Pistol,
          quantity: 1,
          origin: 'loadout',
        },
      ],
      losses: [],
    };
    expect(await settleExpedition(t.db, manifest, hashOf('first'))).toEqual({ ok: true });
    await expect(settleExpedition(t.db, manifest, hashOf('second'))).rejects.toThrow();
  });

  it('settles only once under two concurrent attempts with the same manifest', async () => {
    const a = await newPlayer();
    const expeditionId = await activeExpedition([a]);
    const manifest: SettlementManifest = {
      expeditionId,
      outcome: 'extracted',
      eligibleAccountIds: [a.accountId],
      destinations: [
        {
          sourceId: 'loot_1',
          accountId: a.accountId,
          itemId: ItemId.Ore,
          quantity: 5,
          origin: 'container.1',
        },
      ],
      losses: [],
    };
    const hash = hashOf('race');

    const [first, second] = await Promise.all([
      settleExpedition(t.db, manifest, hash),
      settleExpedition(t.db, manifest, hash),
    ]);
    expect(first).toEqual({ ok: true });
    expect(second).toEqual({ ok: true });

    const ore = (await getInventory(t.db, a.accountId)).stash.find(
      (entry) => entry.itemId === ItemId.Ore,
    );
    expect(ore?.quantity).toBe(5);
    expect(await count('settlements', expeditionId, t, 'expedition_id')).toBe(1);
  });

  it('refuses an unknown expedition and one that never started', async () => {
    const unknown: SettlementManifest = {
      expeditionId: randomUUID(),
      outcome: 'extracted',
      eligibleAccountIds: [],
      destinations: [],
      losses: [],
    };
    expect(await settleExpedition(t.db, unknown, hashOf('ghost'))).toEqual({
      ok: false,
      reason: 'not_found',
    });

    const a = await newPlayer();
    const request: StartExpeditionRequest = {
      startKey: randomUUID(),
      leaderAccountId: a.accountId,
      shipId: ShipHullId.Scout,
      members: [
        {
          accountId: a.accountId,
          classId: ClassId.Officer,
          loadout: [{ slot: 'sidearm', instanceId: a.instanceId }],
        },
      ],
    };
    const started = await startExpedition(t.db, request);
    if (!started.ok) throw new Error(started.reason);
    // Still PREPARING: never activated.
    const stillPreparing: SettlementManifest = {
      expeditionId: started.expeditionId,
      outcome: 'extracted',
      eligibleAccountIds: [a.accountId],
      destinations: [],
      losses: [],
    };
    expect(await settleExpedition(t.db, stillPreparing, hashOf('too-soon'))).toEqual({
      ok: false,
      reason: 'not_running',
    });
  });
});

async function count(
  table: string,
  expeditionId: string,
  t: TestDatabase,
  column = 'expedition_id',
): Promise<number> {
  const result = await t.pool.query<{ n: string }>(
    `SELECT count(*) AS n FROM ${table} WHERE ${column} = $1`,
    [expeditionId],
  );
  return Number(result.rows[0]?.n);
}
