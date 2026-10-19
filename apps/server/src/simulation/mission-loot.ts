import { BACKPACK_SLOTS, EQUIP_SLOTS, isItemId } from '@orbit/catalog';
import {
  ErrorCode,
  type InventoryTransfer,
  type MissionInventoryView,
  type MissionItemView,
} from '@orbit/contracts';
import { MissionInventory, type TransferRefusal } from './mission-inventory';
import type { SectorSimulation } from './sector-simulation';
import type { LootStack } from './sector-generator';

export interface LootMember {
  readonly accountId: string;
  readonly nick: string;
  /** Reserved items as recorded at the start of the expedition. */
  readonly loadout: readonly {
    readonly slot: string;
    readonly instanceId: string;
    readonly itemId: string;
    readonly quantity: number;
  }[];
}

const CARGO = 'cargo';
const backpackOf = (accountId: string) => `backpack:${accountId}`;
const equipmentOf = (accountId: string) => `equipment:${accountId}`;

const REFUSALS: Readonly<Record<TransferRefusal, ErrorCode>> = {
  invalid_transfer: ErrorCode.InvalidTransfer,
  item_not_found: ErrorCode.ItemNotFound,
  invalid_quantity: ErrorCode.InvalidQuantity,
  inventory_full: ErrorCode.InventoryFull,
};

/**
 * Loot and gear of one match: who may move what, from where. Every member brings the
 * reserved loadout (equipment stays equipped; the backpack can be emptied into the
 * hold); containers hold loot with temporary IDs. A member reaches the hold only at
 * the cargo hatch, and a container only from there with the hull alongside it, always
 * by the server's positions. Containers are only taken from, and a member's own gear
 * is moved only by that member.
 */
export class MissionLoot {
  readonly inventory: MissionInventory;
  readonly #simulation: SectorSimulation;
  readonly #nicks = new Map<string, string>();

  constructor(options: {
    readonly simulation: SectorSimulation;
    readonly members: readonly LootMember[];
    readonly loot: ReadonlyMap<string, readonly LootStack[]>;
    /** Names new stacks; must never repeat or match a reserved instance ID. */
    readonly newId: () => string;
  }) {
    const { simulation, members, loot, newId } = options;
    this.#simulation = simulation;
    const inventory = new MissionInventory(newId);
    this.inventory = inventory;
    inventory.addHolder(CARGO, simulation.ship.hull.cargoSlots);
    for (const member of members) {
      this.#nicks.set(member.accountId, member.nick);
      inventory.addHolder(equipmentOf(member.accountId), EQUIP_SLOTS.length);
      inventory.addHolder(backpackOf(member.accountId), BACKPACK_SLOTS);
      for (const item of member.loadout) {
        if (!isItemId(item.itemId)) throw new Error(`Item desconhecido no loadout: ${item.itemId}`);
        const holder = item.slot.startsWith('backpack.')
          ? backpackOf(member.accountId)
          : equipmentOf(member.accountId);
        inventory.place(holder, {
          id: item.instanceId,
          itemId: item.itemId,
          quantity: item.quantity,
          owner: member.accountId,
          origin: 'loadout',
        });
      }
    }
    for (const container of simulation.sector.containers) {
      const contents = loot.get(container.id) ?? [];
      inventory.addHolder(container.id, Math.max(1, contents.length));
      for (const stack of contents) {
        inventory.place(container.id, {
          id: newId(),
          itemId: stack.itemId,
          quantity: stack.quantity,
          owner: null,
          origin: container.id,
        });
      }
    }
  }

  /** Moves a stack for a member, or says why not. */
  transfer(accountId: string, sessionId: string, request: InventoryTransfer): ErrorCode | null {
    if (request.from === request.to || request.to.startsWith('container.')) {
      return ErrorCode.InvalidTransfer;
    }
    if (!this.#simulation.isAtHatch(sessionId)) return ErrorCode.NotAtHatch;
    const inReach = this.#simulation.containerInReach();
    const holderKey = (ref: string): string | null => {
      if (ref === 'backpack') return backpackOf(accountId);
      if (ref === 'cargo') return CARGO;
      return ref === inReach && this.inventory.has(ref) ? ref : null;
    };
    const from = holderKey(request.from);
    const to = holderKey(request.to);
    if (from === null || to === null) return ErrorCode.ContainerOutOfReach;
    // Gear brought from a stash is moved only by its owner, wherever it is.
    const owner = this.inventory.find(request.item)?.item.owner ?? null;
    if (owner !== null && owner !== accountId) return ErrorCode.NotItemOwner;
    const result = this.inventory.transfer({
      item: request.item,
      from,
      to,
      quantity: request.quantity,
    });
    return result.ok ? null : REFUSALS[result.code];
  }

  /** Changes whenever what the member can reach changes. */
  accessKey(sessionId: string): string {
    const atHatch = this.#simulation.isAtHatch(sessionId);
    return atHatch ? `hatch:${this.#simulation.containerInReach() ?? ''}` : 'away';
  }

  /** What one member may see: never another member's backpack or an unreached container. */
  view(accountId: string, sessionId: string): MissionInventoryView {
    const items = (key: string): MissionItemView[] =>
      this.inventory.items(key).map((item) => ({
        id: item.id,
        itemId: item.itemId,
        quantity: item.quantity,
        ownerNick: item.owner === null ? null : (this.#nicks.get(item.owner) ?? ''),
        mine: item.owner === accountId,
      }));
    const holder = (key: string) => ({ slots: this.inventory.slots(key), items: items(key) });
    const atHatch = this.#simulation.isAtHatch(sessionId);
    const inReach = atHatch ? this.#simulation.containerInReach() : null;
    return {
      atHatch,
      equipment: items(equipmentOf(accountId)),
      backpack: holder(backpackOf(accountId)),
      cargo: holder(CARGO),
      container:
        inReach && this.inventory.has(inReach) ? { id: inReach, ...holder(inReach) } : null,
    };
  }
}
