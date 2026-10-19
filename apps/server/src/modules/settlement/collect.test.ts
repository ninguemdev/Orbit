import { describe, expect, it } from 'vitest';
import { ItemId } from '@orbit/catalog';
import { MissionInventory } from '../../simulation/mission-inventory';
import { CARGO, backpackOf, equipmentOf } from '../../simulation/mission-loot';
import { buildManifest } from './manifest';
import { collectManifestItems } from './collect';

describe('collectManifestItems', () => {
  it('gathers the hold and every member’s backpack and equipment, never an unreached container', () => {
    let nextId = 0;
    const inventory = new MissionInventory(() => `loot_${nextId++}`);
    inventory.addHolder(CARGO, 10);
    inventory.addHolder(equipmentOf('a'), 1);
    inventory.addHolder(backpackOf('a'), 8);
    inventory.addHolder(equipmentOf('b'), 1);
    inventory.addHolder(backpackOf('b'), 8);
    inventory.addHolder('container.1', 2);

    inventory.place(equipmentOf('a'), {
      id: 'pistol-a',
      itemId: ItemId.Pistol,
      quantity: 1,
      owner: 'a',
      origin: 'loadout',
    });
    inventory.place(backpackOf('b'), {
      id: 'brought-b',
      itemId: ItemId.RepairKit,
      quantity: 1,
      owner: 'b',
      origin: 'loadout',
    });
    inventory.place(CARGO, {
      id: 'loot-1',
      itemId: ItemId.Ore,
      quantity: 5,
      owner: null,
      origin: 'container.1',
    });
    // Never collected: the crew left the sector before reaching it.
    inventory.place('container.1', {
      id: 'loot-left-behind',
      itemId: ItemId.Scrap,
      quantity: 3,
      owner: null,
      origin: 'container.1',
    });

    const items = collectManifestItems(inventory, ['a', 'b']);
    expect(new Set(items.map((item) => item.id))).toEqual(
      new Set(['pistol-a', 'brought-b', 'loot-1']),
    );

    const manifest = buildManifest({
      expeditionId: 'exp-1',
      outcome: 'extracted',
      roster: ['a', 'b'],
      eligibleAccountIds: ['a', 'b'],
      items,
    });
    expect(manifest.destinations.find((d) => d.sourceId === 'pistol-a')).toMatchObject({
      accountId: 'a',
      quantity: 1,
    });
    expect(manifest.destinations.find((d) => d.sourceId === 'brought-b')).toMatchObject({
      accountId: 'b',
      quantity: 1,
    });
    const common = manifest.destinations.filter((d) => d.sourceId === 'loot-1');
    expect(common.reduce((sum, d) => sum + d.quantity, 0)).toBe(5);
  });
});
