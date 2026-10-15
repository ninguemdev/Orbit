import { describe, expect, it } from 'vitest';
import { ClassId, ITEMS, ItemId } from './index';
import { BACKPACK_SLOTS, EQUIP_SLOTS, isLoadoutSlot, loadoutItemIssue } from './loadout';

describe('loadout rules', () => {
  it('accepts only known slots', () => {
    for (const slot of EQUIP_SLOTS) expect(isLoadoutSlot(slot)).toBe(true);
    expect(isLoadoutSlot('backpack.0')).toBe(true);
    expect(isLoadoutSlot(`backpack.${BACKPACK_SLOTS - 1}`)).toBe(true);
    for (const slot of [`backpack.${BACKPACK_SLOTS}`, 'backpack.-1', 'backpack.01', 'head', '']) {
      expect(isLoadoutSlot(slot)).toBe(false);
    }
  });

  it('equips items only in their own slot', () => {
    expect(loadoutItemIssue(ItemId.Pistol, 'sidearm', null)).toBeNull();
    expect(loadoutItemIssue(ItemId.Pistol, 'primary', null)).toBe('wrong_slot');
    expect(loadoutItemIssue(ItemId.RepairKit, 'tool', ClassId.Engineer)).toBeNull();
    expect(loadoutItemIssue(ItemId.Medkit, 'tool', null)).toBe('wrong_slot');
    expect(loadoutItemIssue(ItemId.Scrap, 'primary', null)).toBe('wrong_slot');
  });

  it('restricts class weapons when equipped, not when carried', () => {
    expect(loadoutItemIssue(ItemId.LongRifle, 'primary', ClassId.Officer)).toBeNull();
    expect(loadoutItemIssue(ItemId.LongRifle, 'primary', ClassId.Pilot)).toBe('class_restricted');
    expect(loadoutItemIssue(ItemId.LongRifle, 'primary', null)).toBe('class_restricted');
    expect(loadoutItemIssue(ItemId.LongRifle, 'backpack.3', ClassId.Pilot)).toBeNull();
  });

  it('refuses items and slots outside the catalog', () => {
    expect(loadoutItemIssue('item.weapon.laser', 'primary', null)).toBe('unknown_item');
    expect(loadoutItemIssue('item.weapon.laser', 'backpack.0', null)).toBe('unknown_item');
    expect(loadoutItemIssue(ItemId.Pistol, 'helmet', null)).toBe('invalid_slot');
  });

  it('has an equipment slot for every equippable item', () => {
    for (const item of Object.values(ITEMS)) {
      if (item.equipSlot) expect(EQUIP_SLOTS).toContain(item.equipSlot);
    }
  });
});
