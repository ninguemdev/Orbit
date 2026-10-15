// Type-only: index.ts re-exports this module, so a value import would be circular.
import type { ClassId } from './index';
import { type EquipSlot, ITEMS, isItemId } from './items';

/** Equipment slots, in display order. */
export const EQUIP_SLOTS: readonly EquipSlot[] = ['primary', 'sidearm', 'tool'];

export const EQUIP_SLOT_NAMES: Readonly<Record<EquipSlot, string>> = {
  primary: 'Arma principal',
  sidearm: 'Arma secundária',
  tool: 'Ferramenta',
};

/** Backpack capacity during a mission (docs/02). */
export const BACKPACK_SLOTS = 8;

/** A loadout position: an equipment slot or `backpack.<index>`. */
export type LoadoutSlot = EquipSlot | `backpack.${number}`;

export function isLoadoutSlot(value: string): value is LoadoutSlot {
  if ((EQUIP_SLOTS as readonly string[]).includes(value)) return true;
  const match = /^backpack\.(\d)$/.exec(value);
  return match !== null && Number(match[1]) < BACKPACK_SLOTS;
}

export const backpackSlot = (index: number): LoadoutSlot => `backpack.${index}`;

/** Why an item cannot go in a loadout position. */
export type LoadoutIssue =
  | 'invalid_slot'
  | 'unknown_item'
  | 'wrong_slot'
  | 'class_restricted'
  | 'not_owned'
  | 'duplicate_item'
  | 'duplicate_slot';

/**
 * Catalog rules for one item in one position. Equipment slots take only items made
 * for that slot and allowed for the class; the backpack takes any catalog item (it
 * can carry gear for another crew member). Ownership is checked by the caller.
 */
export function loadoutItemIssue(
  itemId: string,
  slot: string,
  classId: ClassId | null,
): LoadoutIssue | null {
  if (!isLoadoutSlot(slot)) return 'invalid_slot';
  if (!isItemId(itemId)) return 'unknown_item';
  if (slot.startsWith('backpack.')) return null;
  const item = ITEMS[itemId];
  if (item.equipSlot !== slot) return 'wrong_slot';
  if (item.classes && (classId === null || !item.classes.includes(classId))) {
    return 'class_restricted';
  }
  return null;
}
