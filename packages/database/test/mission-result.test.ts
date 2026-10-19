import { createHash, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ClassId, DEFAULT_APPEARANCE_COLOR, ItemId, ShipHullId } from '@orbit/catalog';
import {
  type StartExpeditionRequest,
  abortExpedition,
  activateExpedition,
  cancelPreparation,
  getLastMissionResult,
  startExpedition,
} from '../src/expedition/expeditions';
import { type SettlementManifest, settleExpedition } from '../src/expedition/settlement';
import { createAccount } from '../src/identity/accounts';
import { updateProfileClass } from '../src/identity/sessions';
import { getInventory, grantItem } from '../src/inventory/inventory';
import { type LoadoutPick, setLoadout } from '../src/inventory/loadout';
import { FAKE_ARGON2ID_HASH, type TestDatabase, createTestDatabase } from './test-database';

const hashOf = (label: string) => createHash('sha256').update(label).digest('hex');

describe('getLastMissionResult', () => {
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
      nick: `Result_${++counter}`,
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

  async function startedExpedition(player: Player): Promise<string> {
    const request: StartExpeditionRequest = {
      startKey: randomUUID(),
      leaderAccountId: player.accountId,
      shipId: ShipHullId.Scout,
      members: [
        {
          accountId: player.accountId,
          classId: ClassId.Officer,
          loadout: [{ slot: 'sidearm', instanceId: player.instanceId }],
        },
      ],
    };
    const started = await startExpedition(t.db, request);
    if (!started.ok) throw new Error(started.reason);
    return started.expeditionId;
  }

  it('is null before the account has ever finished a mission', async () => {
    const player = await newPlayer();
    expect(await getLastMissionResult(t.db, player.accountId)).toBeNull();
  });

  it("reports a settled extraction with the account's own returned, received and lost items", async () => {
    const owner = await newPlayer();
    const bystander = await newPlayer();
    const expeditionId = await startedExpedition(owner);
    expect(await activateExpedition(t.db, expeditionId)).toBe('activated');

    const manifest: SettlementManifest = {
      expeditionId,
      outcome: 'extracted',
      eligibleAccountIds: [owner.accountId],
      destinations: [
        {
          sourceId: owner.instanceId,
          accountId: owner.accountId,
          itemId: ItemId.Pistol,
          quantity: 1,
          origin: 'loadout',
        },
        {
          sourceId: 'loot_1',
          accountId: owner.accountId,
          itemId: ItemId.Ore,
          quantity: 4,
          origin: 'container.1',
        },
      ],
      losses: [
        {
          sourceId: 'loot_2',
          accountId: null,
          itemId: ItemId.Scrap,
          quantity: 2,
          origin: 'container.1',
          reason: 'no_recipients',
        },
      ],
    };
    expect(await settleExpedition(t.db, manifest, hashOf('extracted'))).toEqual({ ok: true });

    const result = await getLastMissionResult(t.db, owner.accountId);
    expect(result?.expeditionId).toBe(expeditionId);
    expect(result?.outcome).toBe('extracted');
    expect(result?.returned).toEqual([{ itemId: ItemId.Pistol, quantity: 1 }]);
    expect(result?.received).toEqual([{ itemId: ItemId.Ore, quantity: 4 }]);
    expect(result?.lost).toEqual([]);

    // A bystander who was never a member of this expedition sees no result from it.
    expect(await getLastMissionResult(t.db, bystander.accountId)).toBeNull();
  });

  it('lists lost personal gear for a member who was not eligible', async () => {
    const owner = await newPlayer();
    const expeditionId = await startedExpedition(owner);
    expect(await activateExpedition(t.db, expeditionId)).toBe('activated');
    const manifest: SettlementManifest = {
      expeditionId,
      outcome: 'destroyed',
      eligibleAccountIds: [],
      destinations: [],
      losses: [
        {
          sourceId: owner.instanceId,
          accountId: owner.accountId,
          itemId: ItemId.Pistol,
          quantity: 1,
          origin: 'loadout',
          reason: 'mission_failed',
        },
      ],
    };
    expect(await settleExpedition(t.db, manifest, hashOf('destroyed'))).toEqual({ ok: true });

    const result = await getLastMissionResult(t.db, owner.accountId);
    expect(result?.outcome).toBe('destroyed');
    expect(result?.returned).toEqual([]);
    expect(result?.lost).toEqual([{ itemId: ItemId.Pistol, quantity: 1 }]);
  });

  it('reports a technical abort with nothing to list', async () => {
    const owner = await newPlayer();
    const expeditionId = await startedExpedition(owner);
    expect(await activateExpedition(t.db, expeditionId)).toBe('activated');
    expect(await abortExpedition(t.db, expeditionId)).toBe('aborted');

    const result = await getLastMissionResult(t.db, owner.accountId);
    expect(result).toEqual({
      expeditionId,
      outcome: 'aborted',
      endedAt: result?.endedAt,
      returned: [],
      received: [],
      lost: [],
    });
  });

  it('reports a cancelled preparation with nothing to list', async () => {
    const owner = await newPlayer();
    const expeditionId = await startedExpedition(owner);
    expect(await cancelPreparation(t.db, expeditionId)).toBe('cancelled');

    const result = await getLastMissionResult(t.db, owner.accountId);
    expect(result?.outcome).toBe('cancelled');
    expect(result?.returned).toEqual([]);
  });

  it('reports the most recently ended expedition, not an older one', async () => {
    const owner = await newPlayer();
    const first = await startedExpedition(owner);
    expect(await activateExpedition(t.db, first)).toBe('activated');
    expect(await abortExpedition(t.db, first)).toBe('aborted');

    // The abort released the reservation: the same pistol can go on a second mission.
    const second = await startedExpedition(owner);
    expect(await activateExpedition(t.db, second)).toBe('activated');
    const manifest: SettlementManifest = {
      expeditionId: second,
      outcome: 'extracted',
      eligibleAccountIds: [owner.accountId],
      destinations: [
        {
          sourceId: owner.instanceId,
          accountId: owner.accountId,
          itemId: ItemId.Pistol,
          quantity: 1,
          origin: 'loadout',
        },
      ],
      losses: [],
    };
    expect(await settleExpedition(t.db, manifest, hashOf('second'))).toEqual({ ok: true });

    const result = await getLastMissionResult(t.db, owner.accountId);
    expect(result?.expeditionId).toBe(second);
    expect(result?.outcome).toBe('extracted');
  });
});
