import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ClassId, DEFAULT_APPEARANCE_COLOR, ItemId } from '@orbit/catalog';
import { postgresError } from '../src/client';
import { createAccount } from '../src/identity/accounts';
import { updateProfileClass } from '../src/identity/sessions';
import { getInventory, grantItem, moveStashItem } from '../src/inventory/inventory';
import { getLoadout, setLoadout } from '../src/inventory/loadout';
import { FAKE_ARGON2ID_HASH, type TestDatabase, createTestDatabase } from './test-database';

describe('loadout', () => {
  let t: TestDatabase;
  let counter = 0;

  beforeAll(async () => {
    t = await createTestDatabase();
  });

  afterAll(async () => {
    await t?.drop();
  });

  async function newAccount(): Promise<string> {
    const created = await createAccount(t.db, {
      nick: `Load_${++counter}`,
      passwordHash: FAKE_ARGON2ID_HASH,
      colorId: DEFAULT_APPEARANCE_COLOR,
    });
    if (!created.ok) throw new Error('conta não criada');
    return created.accountId;
  }

  /** Grants one stack of the item and returns its instance ID. */
  async function give(accountId: string, itemId: string, quantity = 1): Promise<string> {
    const before = new Set((await getInventory(t.db, accountId)).stash.map((e) => e.instanceId));
    await grantItem(t.db, { accountId, itemId, quantity, origin: 'grant:test', reason: 'teste' });
    const added = (await getInventory(t.db, accountId)).stash.find(
      (entry) => !before.has(entry.instanceId),
    );
    if (!added) throw new Error('item não concedido');
    return added.instanceId;
  }

  it('saves equipment and backpack picks without changing the stash', async () => {
    const accountId = await newAccount();
    const pistol = await give(accountId, ItemId.Pistol);
    const kit = await give(accountId, ItemId.RepairKit);
    const medkits = await give(accountId, ItemId.Medkit, 3);
    const stashBefore = (await getInventory(t.db, accountId)).stash;

    expect(
      await setLoadout(t.db, accountId, [
        { slot: 'sidearm', instanceId: pistol },
        { slot: 'tool', instanceId: kit },
        { slot: 'backpack.0', instanceId: medkits },
      ]),
    ).toEqual({ ok: true });
    expect((await getInventory(t.db, accountId)).stash).toEqual(stashBefore);

    const loadout = await getLoadout(t.db, accountId);
    expect(loadout.entries.map((entry) => [entry.slot, entry.itemId, entry.issue])).toEqual([
      ['backpack.0', ItemId.Medkit, null],
      ['sidearm', ItemId.Pistol, null],
      ['tool', ItemId.RepairKit, null],
    ]);

    // Rearranging the stash keeps the picks: they point to items, not to stash slots.
    expect(await moveStashItem(t.db, accountId, 0, 20)).toBe('moved');
    expect((await getLoadout(t.db, accountId)).entries).toHaveLength(3);

    // Saving again replaces the whole loadout.
    expect(await setLoadout(t.db, accountId, [{ slot: 'backpack.7', instanceId: pistol }])).toEqual(
      { ok: true },
    );
    expect((await getLoadout(t.db, accountId)).entries.map((entry) => entry.slot)).toEqual([
      'backpack.7',
    ]);
  });

  it('refuses forged picks and saves nothing from a refused request', async () => {
    const owner = await newAccount();
    const other = await newAccount();
    const rifle = await give(owner, ItemId.LongRifle);
    const pistol = await give(owner, ItemId.Pistol);
    const foreign = await give(other, ItemId.Pistol);
    await setLoadout(t.db, owner, [{ slot: 'sidearm', instanceId: pistol }]);

    const result = await setLoadout(t.db, owner, [
      { slot: 'primary', instanceId: rifle }, // class not chosen: only officers
      { slot: 'tool', instanceId: pistol }, // wrong slot
      { slot: 'sidearm', instanceId: foreign }, // another account's item
      { slot: 'backpack.0', instanceId: '00000000-0000-4000-8000-000000000000' }, // unknown
      { slot: 'backpack.1', instanceId: pistol }, // same item twice
      { slot: 'backpack.9', instanceId: rifle }, // no such slot
      { slot: 'backpack.0', instanceId: rifle }, // same slot twice
    ]);
    expect(result).toEqual({
      ok: false,
      issues: [
        { slot: 'primary', issue: 'class_restricted' },
        { slot: 'tool', issue: 'wrong_slot' },
        { slot: 'sidearm', issue: 'not_owned' },
        { slot: 'backpack.0', issue: 'not_owned' },
        { slot: 'backpack.1', issue: 'duplicate_item' },
        { slot: 'backpack.9', issue: 'invalid_slot' },
        { slot: 'backpack.0', issue: 'duplicate_slot' },
      ],
    });
    // The previous loadout is intact, and the other account's item was not touched.
    expect((await getLoadout(t.db, owner)).entries.map((entry) => entry.instanceId)).toEqual([
      pistol,
    ]);
    expect((await getLoadout(t.db, other)).entries).toEqual([]);
    expect(
      await setLoadout(t.db, owner, [{ slot: 'backpack.9', instanceId: pistol }]),
    ).toMatchObject({ ok: false, issues: [{ slot: 'backpack.9', issue: 'invalid_slot' }] });
  });

  it('accepts class weapons for the class and flags them after a class change', async () => {
    const accountId = await newAccount();
    const rifle = await give(accountId, ItemId.LongRifle);
    await updateProfileClass(t.db, accountId, ClassId.Officer);
    expect(await setLoadout(t.db, accountId, [{ slot: 'primary', instanceId: rifle }])).toEqual({
      ok: true,
    });
    await updateProfileClass(t.db, accountId, ClassId.Pilot);
    const loadout = await getLoadout(t.db, accountId);
    expect(loadout.classId).toBe(ClassId.Pilot);
    expect(loadout.entries).toMatchObject([{ slot: 'primary', issue: 'class_restricted' }]);
  });

  it('enforces ownership, stash location and single use in the database', async () => {
    const owner = await newAccount();
    const intruder = await newAccount();
    const pistol = await give(owner, ItemId.Pistol);
    const insert = async (accountId: string, slot: string, instanceId: string) => {
      try {
        await t.pool.query(
          'INSERT INTO loadout_items (account_id, slot, item_instance_id) VALUES ($1, $2, $3)',
          [accountId, slot, instanceId],
        );
        return null;
      } catch (error) {
        return postgresError(error);
      }
    };
    expect(await insert(intruder, 'sidearm', pistol)).toMatchObject({
      code: '23503',
      constraint: 'loadout_items_item_owned_in_stash',
    });
    expect(await insert(owner, 'helmet', pistol)).toMatchObject({
      constraint: 'loadout_items_slot_known',
    });
    expect(await insert(owner, 'sidearm', pistol)).toBeNull();
    expect(await insert(owner, 'backpack.2', pistol)).toMatchObject({
      constraint: 'loadout_items_item_key',
    });
    // A picked item cannot silently leave the stash.
    await expect(
      t.pool.query("UPDATE item_instances SET location = 'inbox' WHERE id = $1", [pistol]),
    ).rejects.toMatchObject({ code: '23503' });
  });
});
