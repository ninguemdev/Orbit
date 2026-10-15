import { ErrorCode, parseJoinOptions, type JoinOptions } from '@orbit/contracts';

export interface AccessPolicy {
  readonly allowedOrigins: ReadonlySet<string>;
  readonly allowMissingOrigin: boolean;
}

export function isOriginAllowed(policy: AccessPolicy, origin: string | null | undefined): boolean {
  if (origin === null || origin === undefined || origin === '') return policy.allowMissingOrigin;
  return policy.allowedOrigins.has(origin);
}

export type JoinDecision =
  | { readonly ok: true; readonly options: JoinOptions }
  | { readonly ok: false; readonly code: ErrorCode };

/**
 * 0.1 development rooms accept anonymous players from allowed origins speaking the
 * current protocol. Account sessions and single-use seat tickets replace this in 0.2.
 */
export function decideJoin(
  policy: AccessPolicy,
  origin: string | null,
  options: unknown,
): JoinDecision {
  if (!isOriginAllowed(policy, origin)) return { ok: false, code: ErrorCode.OriginNotAllowed };
  const parsed = parseJoinOptions(options);
  return parsed.ok ? { ok: true, options: parsed.value } : { ok: false, code: parsed.code };
}
