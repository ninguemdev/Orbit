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
} as const;
export type ClientMessage = (typeof ClientMessage)[keyof typeof ClientMessage];

/** Server → client notifications. */
export const ServerMessage = {
  ActionRejected: 'action.rejected',
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

export function parseJoinOptions(raw: unknown): ParseResult<JoinOptions> {
  const result = joinOptionsSchema.safeParse(raw);
  if (result.success) return { ok: true, value: result.data };
  const version = (raw as { protocolVersion?: unknown } | null)?.protocolVersion;
  return {
    ok: false,
    code: version !== PROTOCOL_VERSION ? ErrorCode.ProtocolMismatch : ErrorCode.InvalidPayload,
  };
}
