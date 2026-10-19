import type { MissionInventory, MissionItem } from '../../simulation/mission-inventory';
import { CARGO, backpackOf, equipmentOf } from '../../simulation/mission-loot';
import type { ManifestSourceItem } from './manifest';

/**
 * Every item a `buildManifest` call needs to resolve: the ship's hold and each member's
 * backpack and equipment. A container never reached stays behind on purpose — nothing
 * never collected is ever part of the manifest.
 */
export function collectManifestItems(
  inventory: MissionInventory,
  accountIds: readonly string[],
): ManifestSourceItem[] {
  const items: ManifestSourceItem[] = [];
  for (const item of inventory.items(CARGO)) items.push(toSourceItem(item));
  for (const accountId of accountIds) {
    for (const item of inventory.items(backpackOf(accountId))) items.push(toSourceItem(item));
    for (const item of inventory.items(equipmentOf(accountId))) items.push(toSourceItem(item));
  }
  return items;
}

function toSourceItem(item: Readonly<MissionItem>): ManifestSourceItem {
  return {
    id: item.id,
    itemId: item.itemId,
    quantity: item.quantity,
    owner: item.owner,
    origin: item.origin,
  };
}
