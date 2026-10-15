import { ITEMS, SHIP_HULLS, isItemId, isShipHullId } from '@orbit/catalog';

/** Display names from the catalog; unknown IDs are shown as they are. */
export const itemName = (itemId: string) => (isItemId(itemId) ? ITEMS[itemId].name : itemId);
export const shipName = (shipId: string) =>
  isShipHullId(shipId) ? SHIP_HULLS[shipId].name : shipId;
