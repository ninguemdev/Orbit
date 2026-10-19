import { z } from 'zod';
import { nickSchema } from './identity';

/** Bump when a message or state field changes incompatibly. */
export const PROTOCOL_VERSION = 1;

export const DEV_ROOM_NAME = 'dev_sector';

/** Fixed simulation rate of authoritative rooms. */
export const TICK_RATE_HZ = 20;
/** Clients send continuous input at most this often. */
export const INPUT_SEND_RATE_HZ = 20;
/** Input not refreshed within this window is treated as neutral. */
export const INPUT_STALE_MS = 250;
/** Remote entities are rendered this far in the past to interpolate between patches. */
export const INTERPOLATION_DELAY_MS = 100;
export const MAX_CREW = 4;
export const RECONNECTION_WINDOW_SECONDS = 60;

/** Client → server intents. */
export const ClientMessage = {
  CrewInput: 'crew.input',
  ShipInput: 'ship.input',
  HelmRequest: 'helm.request',
  HelmRelease: 'helm.release',
  /** Mission rooms: move a stack between the container, the backpack and the hold. */
  InventoryTransfer: 'inventory.transfer',
  /** Mission rooms: the helm operator starts the evacuation countdown. */
  RequestExtraction: 'extraction.request',
} as const;
export type ClientMessage = (typeof ClientMessage)[keyof typeof ClientMessage];

/** Server → client notifications. */
export const ServerMessage = {
  ActionRejected: 'action.rejected',
  /** Mission rooms: the receiver's own view of the items it can see (MissionInventoryView). */
  Inventory: 'mission.inventory',
  /** Mission rooms: the match just ended with this outcome, right before the room closes. */
  MissionOutcome: 'mission.outcome',
} as const;

export const ErrorCode = {
  InvalidPayload: 'invalid_payload',
  StaleInput: 'stale_input',
  ProtocolMismatch: 'protocol_mismatch',
  OriginNotAllowed: 'origin_not_allowed',
  HelmOccupied: 'helm_occupied',
  HelmOutOfRange: 'helm_out_of_range',
  NotHelmOperator: 'not_helm_operator',
  AtHelm: 'at_helm',
  MatchNotActive: 'match_not_active',
  NotAtHatch: 'not_at_hatch',
  ContainerOutOfReach: 'container_out_of_reach',
  InvalidTransfer: 'invalid_transfer',
  ItemNotFound: 'item_not_found',
  InvalidQuantity: 'invalid_quantity',
  InventoryFull: 'inventory_full',
  NotItemOwner: 'not_item_owner',
  NotInExtractionZone: 'not_in_extraction_zone',
  ExtractionSpeedTooHigh: 'extraction_speed_too_high',
} as const;
export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

export interface ActionRejectedPayload {
  /** Message type that was refused. */
  readonly action: string;
  readonly code: ErrorCode;
}

const sequence = z
  .int()
  .min(0)
  .max(2 ** 31 - 1);
const axis = z.number().min(-1).max(1);

/** Movement intent: direction only. Positions are never accepted from clients. */
export const crewInputSchema = z.strictObject({ seq: sequence, x: axis, y: axis });
export type CrewInput = z.infer<typeof crewInputSchema>;

export const shipInputSchema = z.strictObject({ seq: sequence, thrust: axis, turn: axis });
export type ShipInput = z.infer<typeof shipInputSchema>;

/** Where a stack can be: the sender's backpack, the ship's hold or a container. */
export const holderSchema = z.union([
  z.literal('backpack'),
  z.literal('cargo'),
  z.string().regex(/^container\.[0-9]{1,3}$/),
]);
export type HolderRef = z.infer<typeof holderSchema>;

/** Moves part or all of a stack. The server checks positions, ownership and room. */
export const inventoryTransferSchema = z.strictObject({
  item: z.string().min(1).max(64),
  from: holderSchema,
  to: holderSchema,
  quantity: z.int().min(1).max(10_000),
});
export type InventoryTransfer = z.infer<typeof inventoryTransferSchema>;

/** Messages without payload accept `undefined` or an empty object. */
export const emptyPayloadSchema = z.union([z.undefined(), z.strictObject({})]);

/** Display name in the development room; same rules as the account nick. */
export const displayNameSchema = nickSchema;

export const joinOptionsSchema = z.object({
  protocolVersion: z.literal(PROTOCOL_VERSION),
  name: displayNameSchema.optional(),
});
export type JoinOptions = z.infer<typeof joinOptionsSchema>;

export type ParseResult<T> = { ok: true; value: T } | { ok: false; code: ErrorCode };

function parser<T>(schema: z.ZodType<T>) {
  return (raw: unknown): ParseResult<T> => {
    const result = schema.safeParse(raw);
    return result.success
      ? { ok: true, value: result.data }
      : { ok: false, code: ErrorCode.InvalidPayload };
  };
}

export const parseCrewInput = parser(crewInputSchema);
export const parseShipInput = parser(shipInputSchema);
export const parseEmptyPayload = parser(emptyPayloadSchema);
export const parseInventoryTransfer = parser(inventoryTransferSchema);

export function parseJoinOptions(raw: unknown): ParseResult<JoinOptions> {
  const result = joinOptionsSchema.safeParse(raw);
  if (result.success) return { ok: true, value: result.data };
  const version = (raw as { protocolVersion?: unknown } | null)?.protocolVersion;
  return {
    ok: false,
    code: version !== PROTOCOL_VERSION ? ErrorCode.ProtocolMismatch : ErrorCode.InvalidPayload,
  };
}
