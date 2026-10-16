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
