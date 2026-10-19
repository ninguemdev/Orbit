import { ITEMS, type ItemId } from '@orbit/catalog';

/** One stack carried during a mission. Lives in memory; settlement persists the result. */
export interface MissionItem {
  /** Reserved instance ID for gear brought from the stash; a temporary ID for loot. */
  readonly id: string;
  readonly itemId: ItemId;
  quantity: number;
  /** Account whose gear it is, or null for common loot found in the mission. */
  readonly owner: string | null;
  /** Where it entered the mission: `loadout` or the ID of the container it came from. */
  readonly origin: string;
}

interface Holder {
  readonly slots: number;
  readonly items: MissionItem[];
}

export type TransferRefusal =
  'invalid_transfer' | 'item_not_found' | 'invalid_quantity' | 'inventory_full';

export type TransferResult =
  { readonly ok: true } | { readonly ok: false; readonly code: TransferRefusal };

export interface TransferRequest {
  /** ID of the stack to move. */
  readonly item: string;
  readonly from: string;
  readonly to: string;
  readonly quantity: number;
}

const refuse = (code: TransferRefusal): TransferResult => ({ ok: false, code });

/**
 * Every item of one mission and where it is: backpacks, equipment, the ship's hold and
 * containers. Moving is the only way items change place, and every move keeps the
 * total of each kind: a stack is never copied, and a split or merge adds up exactly.
 * Who may move what is decided by the caller; this class keeps the quantities right.
 */
export class MissionInventory {
  readonly #holders = new Map<string, Holder>();
  readonly #newId: () => string;

  /** `newId` names the stacks created by splitting; it must never repeat. */
  constructor(newId: () => string) {
    this.#newId = newId;
  }

  addHolder(key: string, slots: number): void {
    if (this.#holders.has(key)) throw new Error(`Compartimento duplicado: ${key}`);
    this.#holders.set(key, { slots, items: [] });
  }

  /** Puts an item in a free slot when the mission starts. Never merges. */
  place(key: string, item: MissionItem): void {
    const holder = this.#holder(key);
    if (holder.items.length >= holder.slots) throw new Error(`Sem espaço em ${key}`);
    if (!Number.isInteger(item.quantity) || item.quantity < 1) {
      throw new Error(`Quantidade inválida: ${item.id}`);
    }
    if (item.quantity > ITEMS[item.itemId].maxStack)
      throw new Error(`Pilha grande demais: ${item.id}`);
    if (this.find(item.id)) throw new Error(`Item duplicado: ${item.id}`);
    holder.items.push({ ...item });
  }

  has(key: string): boolean {
    return this.#holders.has(key);
  }

  slots(key: string): number {
    return this.#holder(key).slots;
  }

  items(key: string): readonly Readonly<MissionItem>[] {
    return this.#holder(key).items;
  }

  /** Where a stack is, or null when no holder has it. */
  find(id: string): { readonly key: string; readonly item: Readonly<MissionItem> } | null {
    for (const [key, holder] of this.#holders) {
      const item = holder.items.find((candidate) => candidate.id === id);
      if (item) return { key, item };
    }
    return null;
  }

  /**
   * Moves `quantity` of a stack, all or nothing. Common loot fills matching stacks of
   * the destination first and then takes free slots; part of a stack moves as a new
   * stack with a new ID. Gear brought from the stash keeps its ID: it moves whole and
   * never merges. Refused without any change when the destination cannot take it all.
   */
  transfer({ item, from, to, quantity }: TransferRequest): TransferResult {
    if (from === to) return refuse('invalid_transfer');
    const source = this.#holders.get(from);
    const target = this.#holders.get(to);
    if (!source || !target) return refuse('invalid_transfer');
    const index = source.items.findIndex((candidate) => candidate.id === item);
    const moving = source.items[index];
    if (!moving) return refuse('item_not_found');
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > moving.quantity) {
      return refuse('invalid_quantity');
    }
    if (moving.owner !== null && quantity !== moving.quantity) return refuse('invalid_quantity');

    const { maxStack } = ITEMS[moving.itemId];
    const fills: [MissionItem, number][] = [];
    let remaining = quantity;
    if (moving.owner === null) {
      for (const stack of target.items) {
        if (remaining === 0) break;
        const room = maxStack - stack.quantity;
        if (!sameKind(stack, moving) || room <= 0) continue;
        const added = Math.min(room, remaining);
        fills.push([stack, added]);
        remaining -= added;
      }
    }
    // Stacks never exceed maxStack, so what is left fits in one new stack.
    if (remaining > 0 && target.items.length >= target.slots) return refuse('inventory_full');

    for (const [stack, added] of fills) stack.quantity += added;
    if (quantity === moving.quantity) {
      source.items.splice(index, 1);
      if (remaining > 0) {
        moving.quantity = remaining;
        target.items.push(moving);
      }
    } else {
      moving.quantity -= quantity;
      if (remaining > 0) target.items.push({ ...moving, id: this.#newId(), quantity: remaining });
    }
    return { ok: true };
  }

  #holder(key: string): Holder {
    const holder = this.#holders.get(key);
    if (!holder) throw new Error(`Compartimento desconhecido: ${key}`);
    return holder;
  }
}

/** Common loot of the same item and origin stacks together; nothing else does. */
function sameKind(a: MissionItem, b: MissionItem): boolean {
  return a.owner === null && b.owner === null && a.itemId === b.itemId && a.origin === b.origin;
}
