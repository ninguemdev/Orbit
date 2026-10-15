// Type-only: index.ts re-exports this module, so a value import would be circular.
import type { ClassId, ShipHullId } from './index';

/** Equipment slots filled during mission preparation (V02.08). */
export type EquipSlot = 'primary' | 'sidearm' | 'tool';

export type ItemCategory = 'weapon' | 'tool' | 'consumable' | 'resource';

export interface ItemDefinition {
  readonly id: string;
  readonly name: string;
  readonly category: ItemCategory;
  /** Units that fit in one stash slot; 1 = unique, non-stackable. */
  readonly maxStack: number;
  readonly equipSlot?: EquipSlot;
  /** Classes allowed to equip it; absent = every class. */
  readonly classes?: readonly ClassId[];
}

/** Stable item IDs: never reuse one for a different meaning. */
export const ItemId = {
  Pistol: 'item.weapon.pistol',
  LongRifle: 'item.weapon.long_rifle',
  RepairKit: 'item.tool.repair_kit',
  Medkit: 'item.consumable.medkit',
  Scrap: 'item.resource.scrap',
  Ore: 'item.resource.ore',
} as const;
export type ItemId = (typeof ItemId)[keyof typeof ItemId];

export const ITEMS: Readonly<Record<ItemId, ItemDefinition>> = {
  [ItemId.Pistol]: {
    id: ItemId.Pistol,
    name: 'Pistola padrão',
    category: 'weapon',
    maxStack: 1,
    equipSlot: 'sidearm',
  },
  [ItemId.LongRifle]: {
    id: ItemId.LongRifle,
    name: 'Fuzil longo',
    category: 'weapon',
    maxStack: 1,
    equipSlot: 'primary',
    classes: ['class.officer' satisfies ClassId],
  },
  [ItemId.RepairKit]: {
    id: ItemId.RepairKit,
    name: 'Kit de reparo',
    category: 'tool',
    maxStack: 1,
    equipSlot: 'tool',
  },
  [ItemId.Medkit]: { id: ItemId.Medkit, name: 'Kit médico', category: 'consumable', maxStack: 5 },
  [ItemId.Scrap]: { id: ItemId.Scrap, name: 'Sucata', category: 'resource', maxStack: 50 },
  [ItemId.Ore]: { id: ItemId.Ore, name: 'Minério', category: 'resource', maxStack: 50 },
};

export function isItemId(value: string): value is ItemId {
  return Object.hasOwn(ITEMS, value);
}

/** Permanent stash capacity in slots; overflow goes to the inbox. */
export const STASH_SLOTS = 40;

/** What every new account receives. The free mission kit is separate and never kept. */
export const STARTER_PACKAGE = {
  credits: 200,
  ships: ['ship.scout'] as readonly ShipHullId[],
} as const;
