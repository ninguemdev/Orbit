import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_APPEARANCE_COLOR, ItemId, STARTER_PACKAGE, STASH_SLOTS } from '@orbit/catalog';
import { postgresError } from '../src/client';
import { createAccount } from '../src/identity/accounts';
import { getInventory, grantItem, moveStashItem } from '../src/inventory/inventory';
import { FAKE_ARGON2ID_HASH, type TestDatabase, createTestDatabase } from './test-database';

describe('inventory, wallet and ship licenses', () => {
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
      nick: `Inv_${++counter}`,
      passwordHash: FAKE_ARGON2ID_HASH,
      colorId: DEFAULT_APPEARANCE_COLOR,
    });
    if (!created.ok) throw new Error('conta não criada');
    return created.accountId;
  }

  async function sqlError(query: string, params: unknown[] = []) {
    try {
      await t.pool.query(query, params);
    } catch (error) {
      return postgresError(error);
    }
    return null;
  }

  const grant = (accountId: string, itemId: string, quantity: number) =>
    grantItem(t.db, { accountId, itemId, quantity, origin: 'grant:test', reason: 'teste' });

  it('gives every new account the starter wallet and ship license', async () => {
    const accountId = await newAccount();
    const inventory = await getInventory(t.db, accountId);
    expect(inventory.credits).toBe(STARTER_PACKAGE.credits);
    expect(inventory.ships).toEqual([{ shipId: 'ship.scout', source: 'grant:starter' }]);
    expect(inventory.stash).toEqual([]);
    expect(inventory.inbox).toEqual([]);
  });

  it('stacks items up to the catalog limit, one stack per slot', async () => {
    const accountId = await newAccount();
    expect(await grant(accountId, ItemId.Scrap, 120)).toEqual({ toStash: 120, toInbox: 0 });
    expect(await grant(accountId, ItemId.Pistol, 2)).toEqual({ toStash: 2, toInbox: 0 });
    const { stash } = await getInventory(t.db, accountId);
    expect(stash.map((entry) => [entry.slot, entry.itemId, entry.quantity])).toEqual([
      [0, ItemId.Scrap, 50],
      [1, ItemId.Scrap, 50],
      [2, ItemId.Scrap, 20],
      [3, ItemId.Pistol, 1],
      [4, ItemId.Pistol, 1],
    ]);
  });

  it('sends what does not fit to the inbox instead of discarding it', async () => {
    const accountId = await newAccount();
    expect(await grant(accountId, ItemId.Pistol, STASH_SLOTS + 3)).toEqual({
      toStash: STASH_SLOTS,
      toInbox: 3,
    });
    const inventory = await getInventory(t.db, accountId);
    expect(inventory.stash).toHaveLength(STASH_SLOTS);
    expect(inventory.inbox.map((entry) => [entry.itemId, entry.reason])).toEqual(
      Array.from({ length: 3 }, () => [ItemId.Pistol, 'teste']),
    );
  });

  it('serializes concurrent grants to the same account without losing items', async () => {
    const accountId = await newAccount();
    await Promise.all(Array.from({ length: 10 }, () => grant(accountId, ItemId.RepairKit, 3)));
    const { stash, inbox } = await getInventory(t.db, accountId);
    expect(stash).toHaveLength(30);
    expect(new Set(stash.map((entry) => entry.slot)).size).toBe(30);
    expect(inbox).toHaveLength(0);
  });

  it('moves and swaps only inside the owner stash', async () => {
    const owner = await newAccount();
    const other = await newAccount();
    await grant(owner, ItemId.Pistol, 1);
    await grant(owner, ItemId.Medkit, 2);
    expect(await moveStashItem(t.db, owner, 0, 10)).toBe('moved');
    expect(await moveStashItem(t.db, owner, 1, 10)).toBe('swapped');
    const { stash } = await getInventory(t.db, owner);
    expect(stash.map((entry) => [entry.slot, entry.itemId])).toEqual([
      [1, ItemId.Pistol],
      [10, ItemId.Medkit],
    ]);
    // Another account cannot reach those slots: its own stash is empty.
    expect(await moveStashItem(t.db, other, 10, 0)).toBe('empty_slot');
    expect(await moveStashItem(t.db, owner, 0, STASH_SLOTS)).toBe('invalid_slot');
    expect((await getInventory(t.db, other)).stash).toEqual([]);
  });

  it('enforces ownership, single placement and valid values in the database', async () => {
    const owner = await newAccount();
    const intruder = await newAccount();
    await grant(owner, ItemId.LongRifle, 1);
    const [entry] = (await getInventory(t.db, owner)).stash;
    if (!entry) throw new Error('item ausente');

    // An owner's item not yet placed anywhere, so only the ownership key can refuse it.
    const loose = await t.pool.query<{ id: string }>(
      "INSERT INTO item_instances (item_id, owner_account_id, quantity, origin, location) VALUES ('item.weapon.pistol', $1, 1, 'grant:test', 'stash') RETURNING id",
      [owner],
    );
    expect(
      await sqlError(
        'INSERT INTO inventory_slots (account_id, slot, item_instance_id) VALUES ($1, 0, $2)',
        [intruder, loose.rows[0]?.id],
      ),
    ).toMatchObject({ code: '23503', constraint: 'inventory_slots_item_owned_in_stash' });
    expect(
      await sqlError(
        'INSERT INTO inventory_slots (account_id, slot, item_instance_id) VALUES ($1, 5, $2)',
        [owner, entry.instanceId],
      ),
    ).toMatchObject({ code: '23505', constraint: 'inventory_slots_item_key' });
    expect(
      await sqlError(
        "INSERT INTO inbox_entries (account_id, item_instance_id, reason) VALUES ($1, $2, 'x')",
        [owner, entry.instanceId],
      ),
    ).toMatchObject({ code: '23503', constraint: 'inbox_entries_item_owned_in_inbox' });
    expect(
      await sqlError("UPDATE item_instances SET location = 'inbox' WHERE id = $1", [
        entry.instanceId,
      ]),
    ).toMatchObject({ code: '23503' });
    expect(
      await sqlError('UPDATE item_instances SET quantity = 0 WHERE id = $1', [entry.instanceId]),
    ).toMatchObject({ constraint: 'item_instances_quantity_positive' });
    expect(
      await sqlError('UPDATE wallets SET credits = -1 WHERE account_id = $1', [owner]),
    ).toMatchObject({ constraint: 'wallets_credits_not_negative' });
    expect(
      await sqlError(
        "INSERT INTO ship_unlocks (account_id, ship_id, source) VALUES ($1, 'ship.scout', 'x')",
        [owner],
      ),
    ).toMatchObject({ code: '23505' });
  });

  it('refuses items outside the catalog and invalid quantities', async () => {
    const accountId = await newAccount();
    await expect(grant(accountId, 'item.weapon.laser', 1)).rejects.toThrow(RangeError);
    await expect(grant(accountId, ItemId.Scrap, 0)).rejects.toThrow(RangeError);
    await expect(grant(accountId, ItemId.Scrap, 1.5)).rejects.toThrow(RangeError);
  });
});
