import { describe, expect, it } from 'vitest';
import { ItemId } from '@orbit/catalog';
import { type MissionItem, MissionInventory } from './mission-inventory';

function counter(prefix = 'novo') {
  let next = 0;
  return () => `${prefix}_${next++}`;
}

function loot(id: string, itemId: MissionItem['itemId'], quantity: number, origin = 'container.1') {
  return { id, itemId, quantity, owner: null, origin };
}

/** Total per kind (item, owner, origin): what a move must never change. */
function totals(inventory: MissionInventory, keys: readonly string[]): Record<string, number> {
  const result: Record<string, number> = {};
  for (const key of keys) {
    for (const item of inventory.items(key)) {
      const kind = `${item.itemId}|${item.owner ?? ''}|${item.origin}`;
      result[kind] = (result[kind] ?? 0) + item.quantity;
    }
  }
  return result;
}

function allIds(inventory: MissionInventory, keys: readonly string[]): string[] {
  return keys.flatMap((key) => inventory.items(key).map((item) => item.id));
}

function setUp(slots = { backpack: 8, cargo: 24 }) {
  const inventory = new MissionInventory(counter());
  inventory.addHolder('container.1', 4);
  inventory.addHolder('backpack:a', slots.backpack);
  inventory.addHolder('cargo', slots.cargo);
  return inventory;
}

describe('MissionInventory', () => {
  it('moves a whole stack keeping its ID', () => {
    const inventory = setUp();
    inventory.place('container.1', loot('l1', ItemId.Scrap, 20));
    expect(
      inventory.transfer({ item: 'l1', from: 'container.1', to: 'backpack:a', quantity: 20 }),
    ).toEqual({ ok: true });
    expect(inventory.items('container.1')).toEqual([]);
    expect(inventory.items('backpack:a')).toEqual([loot('l1', ItemId.Scrap, 20)]);
  });

  it('splits part of a stack into a new stack with a new ID', () => {
    const inventory = setUp();
    inventory.place('container.1', loot('l1', ItemId.Scrap, 20));
    inventory.transfer({ item: 'l1', from: 'container.1', to: 'backpack:a', quantity: 7 });
    expect(inventory.items('container.1')).toEqual([loot('l1', ItemId.Scrap, 13)]);
    expect(inventory.items('backpack:a')).toEqual([loot('novo_0', ItemId.Scrap, 7)]);
  });

  it('fills matching stacks first and never above the stack limit', () => {
    const inventory = setUp();
    inventory.place('container.1', loot('l1', ItemId.Scrap, 30));
    inventory.place('backpack:a', loot('b1', ItemId.Scrap, 45));
    // Another origin or item does not stack with it.
    inventory.place('backpack:a', loot('b2', ItemId.Scrap, 10, 'container.2'));
    inventory.place('backpack:a', loot('b3', ItemId.Ore, 10));
    inventory.transfer({ item: 'l1', from: 'container.1', to: 'backpack:a', quantity: 30 });
    expect(inventory.items('backpack:a')).toEqual([
      loot('b1', ItemId.Scrap, 50),
      loot('b2', ItemId.Scrap, 10, 'container.2'),
      loot('b3', ItemId.Ore, 10),
      // The original stack keeps its ID with what did not fit in b1.
      loot('l1', ItemId.Scrap, 25),
    ]);
  });

  it('absorbs a stack entirely when matching stacks have room', () => {
    const inventory = setUp();
    inventory.place('container.1', loot('l1', ItemId.Scrap, 5));
    inventory.place('cargo', loot('c1', ItemId.Scrap, 10));
    inventory.transfer({ item: 'l1', from: 'container.1', to: 'cargo', quantity: 5 });
    expect(inventory.find('l1')).toBeNull();
    expect(inventory.items('cargo')).toEqual([loot('c1', ItemId.Scrap, 15)]);
  });

  it('moves owned gear whole, never merged nor split', () => {
    const inventory = setUp();
    const medkits = {
      id: 'res-1',
      itemId: ItemId.Medkit,
      quantity: 3,
      owner: 'a',
      origin: 'loadout',
    };
    inventory.place('backpack:a', medkits);
    inventory.place('cargo', loot('c1', ItemId.Medkit, 1, 'loadout'));
    expect(
      inventory.transfer({ item: 'res-1', from: 'backpack:a', to: 'cargo', quantity: 1 }),
    ).toEqual({ ok: false, code: 'invalid_quantity' });
    expect(
      inventory.transfer({ item: 'res-1', from: 'backpack:a', to: 'cargo', quantity: 3 }),
    ).toEqual({ ok: true });
    expect(inventory.items('cargo')).toEqual([loot('c1', ItemId.Medkit, 1, 'loadout'), medkits]);
  });

  it('refuses without any change when the destination cannot take it all', () => {
    const inventory = setUp({ backpack: 1, cargo: 24 });
    inventory.place('backpack:a', loot('b1', ItemId.Ore, 48));
    inventory.place('container.1', loot('l1', ItemId.Ore, 5));
    inventory.place('container.1', loot('l2', ItemId.Medkit, 1));
    const before = totals(inventory, ['backpack:a', 'container.1']);
    // Two ore fit in b1, three would need a slot the backpack does not have.
    expect(
      inventory.transfer({ item: 'l1', from: 'container.1', to: 'backpack:a', quantity: 5 }),
    ).toEqual({ ok: false, code: 'inventory_full' });
    expect(
      inventory.transfer({ item: 'l2', from: 'container.1', to: 'backpack:a', quantity: 1 }),
    ).toEqual({ ok: false, code: 'inventory_full' });
    expect(inventory.items('backpack:a')).toEqual([loot('b1', ItemId.Ore, 48)]);
    expect(totals(inventory, ['backpack:a', 'container.1'])).toEqual(before);
    // What fits entirely goes.
    expect(
      inventory.transfer({ item: 'l1', from: 'container.1', to: 'backpack:a', quantity: 2 }),
    ).toEqual({ ok: true });
    expect(inventory.items('backpack:a')).toEqual([loot('b1', ItemId.Ore, 50)]);
  });

  it('refuses bad quantities, unknown stacks and moves to the same place', () => {
    const inventory = setUp();
    inventory.place('container.1', loot('l1', ItemId.Scrap, 10));
    for (const quantity of [0, -3, 11, 1.5, Number.NaN]) {
      expect(
        inventory.transfer({ item: 'l1', from: 'container.1', to: 'cargo', quantity }),
      ).toEqual({ ok: false, code: 'invalid_quantity' });
    }
    expect(
      inventory.transfer({ item: 'l9', from: 'container.1', to: 'cargo', quantity: 1 }),
    ).toEqual({
      ok: false,
      code: 'item_not_found',
    });
    // The stack is in the container, not in the hold it names.
    expect(
      inventory.transfer({ item: 'l1', from: 'cargo', to: 'backpack:a', quantity: 1 }),
    ).toEqual({
      ok: false,
      code: 'item_not_found',
    });
    expect(inventory.transfer({ item: 'l1', from: 'cargo', to: 'cargo', quantity: 1 })).toEqual({
      ok: false,
      code: 'invalid_transfer',
    });
    expect(inventory.transfer({ item: 'l1', from: 'nowhere', to: 'cargo', quantity: 1 })).toEqual({
      ok: false,
      code: 'invalid_transfer',
    });
    expect(inventory.items('container.1')).toEqual([loot('l1', ItemId.Scrap, 10)]);
  });

  it('gives a unique item to the first collector only', () => {
    const inventory = setUp();
    inventory.addHolder('backpack:b', 8);
    inventory.place('container.1', loot('l1', ItemId.Pistol, 1));
    const request = { item: 'l1', from: 'container.1', quantity: 1 } as const;
    expect(inventory.transfer({ ...request, to: 'backpack:a' })).toEqual({ ok: true });
    expect(inventory.transfer({ ...request, to: 'backpack:b' })).toEqual({
      ok: false,
      code: 'item_not_found',
    });
    expect(allIds(inventory, ['container.1', 'backpack:a', 'backpack:b'])).toEqual(['l1']);
  });

  it('refuses duplicates and oversized stacks when the mission starts', () => {
    const inventory = setUp();
    inventory.place('container.1', loot('l1', ItemId.Scrap, 10));
    expect(() => inventory.place('cargo', loot('l1', ItemId.Scrap, 1))).toThrow();
    expect(() => inventory.place('cargo', loot('l2', ItemId.Scrap, 51))).toThrow();
    expect(() => inventory.place('cargo', loot('l3', ItemId.Scrap, 0))).toThrow();
  });

  it('keeps every total and ID unique over many random moves', () => {
    let state = 12345;
    const random = () => {
      state = (state * 1103515245 + 12345) % 2 ** 31;
      return state / 2 ** 31;
    };
    const inventory = new MissionInventory(counter());
    const keys = ['container.1', 'container.2', 'backpack:a', 'backpack:b', 'cargo'];
    inventory.addHolder('container.1', 4);
    inventory.addHolder('container.2', 4);
    inventory.addHolder('backpack:a', 3);
    inventory.addHolder('backpack:b', 3);
    inventory.addHolder('cargo', 5);
    inventory.place('container.1', loot('s1', ItemId.Scrap, 30));
    inventory.place('container.1', loot('o1', ItemId.Ore, 50));
    inventory.place('container.1', loot('m1', ItemId.Medkit, 3));
    inventory.place('container.2', loot('s2', ItemId.Scrap, 41, 'container.2'));
    inventory.place('container.2', loot('p1', ItemId.Pistol, 1, 'container.2'));
    inventory.place('backpack:a', {
      id: 'res-1',
      itemId: ItemId.RepairKit,
      quantity: 1,
      owner: 'a',
      origin: 'loadout',
    });
    const before = totals(inventory, keys);
    let moved = 0;
    for (let step = 0; step < 2000; step++) {
      const from = keys[Math.floor(random() * keys.length)] as string;
      const to = keys[Math.floor(random() * keys.length)] as string;
      const items = inventory.items(from);
      const item = items[Math.floor(random() * items.length)];
      if (!item) continue;
      const quantity = 1 + Math.floor(random() * item.quantity);
      if (inventory.transfer({ item: item.id, from, to, quantity }).ok) moved++;
      expect(totals(inventory, keys)).toEqual(before);
      const ids = allIds(inventory, keys);
      expect(new Set(ids).size).toBe(ids.length);
    }
    expect(moved).toBeGreaterThan(100);
    for (const key of keys) {
      expect(inventory.items(key).length).toBeLessThanOrEqual(inventory.slots(key));
    }
  });
});
