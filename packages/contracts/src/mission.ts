/**
 * The match of one expedition runs in its own room, created by the server when the
 * leader's confirmation reserves the loadouts. Only the expedition's members enter,
 * each with a single-use ticket from the account API.
 */
export const MISSION_ROOM_NAME = 'mission';

/** HTTP route that issues a mission ticket for the session's active expedition. */
export const MissionRoute = { Tickets: '/api/missions/tickets' } as const;

export interface MissionTicketResponse {
  /** Single-use, short-lived; sent as the matchmaking token. */
  readonly ticket: string;
  /** Mission room to join with `joinById`. */
  readonly roomId: string;
}

/** Close code when the preparation is cancelled before the match starts. */
export const MISSION_CANCELLED_CLOSE_CODE = 4410;
/** Close code when the expedition ends while the player is in the room. */
export const MISSION_ENDED_CLOSE_CODE = 4411;

/** One stack as its viewer sees it during a mission. */
export interface MissionItemView {
  readonly id: string;
  readonly itemId: string;
  readonly quantity: number;
  /** Nick of the member whose gear it is; null for common loot. */
  readonly ownerNick: string | null;
  /** The viewer's own gear. */
  readonly mine: boolean;
}

export interface HolderView {
  readonly slots: number;
  readonly items: readonly MissionItemView[];
}

/**
 * Sent to each member alone: their equipment and backpack, the ship's hold and, while
 * they stand at the hatch with the hull alongside one, that container's contents.
 * Other members' backpacks and unopened containers are never sent.
 */
export interface MissionInventoryView {
  readonly atHatch: boolean;
  readonly equipment: readonly MissionItemView[];
  readonly backpack: HolderView;
  readonly cargo: HolderView;
  readonly container: (HolderView & { readonly id: string }) | null;
}
