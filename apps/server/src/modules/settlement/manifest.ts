import { createHash } from 'node:crypto';
import { CATALOG_VERSION, type ItemId } from '@orbit/catalog';

/**
 * One stack as it existed in the mission's live inventory (apps/server/src/simulation/
 * mission-inventory.ts) when extraction resolved: the ship's hold and every member's
 * backpack and equipment. A container never reached stays behind and is out of scope.
 */
export interface ManifestSourceItem {
  readonly id: string;
  readonly itemId: ItemId;
  readonly quantity: number;
  /** Account whose gear it is, or null for common loot. */
  readonly owner: string | null;
  readonly origin: string;
}

export type LossReason = 'mission_failed' | 'not_eligible' | 'no_recipients';

export interface ManifestDestination {
  /** `ManifestSourceItem.id` this portion was split from. */
  readonly sourceId: string;
  readonly accountId: string;
  readonly itemId: ItemId;
  readonly quantity: number;
  readonly origin: string;
}

export interface ManifestLoss {
  readonly sourceId: string;
  /** The owner who lost personal gear, or null for common loot nobody could take. */
  readonly accountId: string | null;
  readonly itemId: ItemId;
  readonly quantity: number;
  readonly origin: string;
  readonly reason: LossReason;
}

/**
 * Immutable record of one extraction (docs/02-GAMEPLAY.md, docs/06-DADOS-E-ECONOMIA.md,
 * V03.06). Built once from the mission's final state; settlement (V03.07) only reads it.
 */
export interface Manifest {
  readonly expeditionId: string;
  readonly catalogVersion: number;
  readonly outcome: 'extracted' | 'destroyed' | 'timeout';
  /** Every member of the expedition, in a stable order. */
  readonly roster: readonly string[];
  /** Subset of `roster` aboard when the match resolved, in roster order. */
  readonly eligibleAccountIds: readonly string[];
  /** Index into `eligibleAccountIds` the rotating split started from. */
  readonly startCursor: number;
  readonly destinations: readonly ManifestDestination[];
  readonly losses: readonly ManifestLoss[];
}

export interface BuildManifestInput {
  readonly expeditionId: string;
  readonly outcome: Manifest['outcome'];
  /** Every member of the expedition, in a stable order (e.g. join order); no duplicates. */
  readonly roster: readonly string[];
  /** Subset of `roster` aboard when the match resolved; its own order does not matter. */
  readonly eligibleAccountIds: readonly string[];
  /** Every stack to resolve; each `id` must be unique. */
  readonly items: readonly ManifestSourceItem[];
  /** Where the rotating split starts; advances by one per common stack. Default 0. */
  readonly startCursor?: number;
}

/**
 * Resolves every item of a mission into who gets what, or why it was lost, without
 * touching a database: a pure function of its input, so the same input always produces
 * the same manifest (`manifestHash` below), and a retry never has to guess again.
 *
 * - Personal gear returns to its owner when eligible; otherwise it is lost, never handed
 *   to someone else.
 * - On failure (destroyed or timeout), nothing returns: every item is lost.
 * - Common loot is split across the eligible crew in roster order, in integer amounts
 *   that always sum to the original quantity; a stack too small to split evenly hands
 *   the remainder to the next recipients after a rotating cursor, so the same member
 *   does not always get the extra unit. A stack of 1 goes to exactly one recipient.
 */
export function buildManifest(input: BuildManifestInput): Manifest {
  const { expeditionId, outcome, roster, items } = input;

  const rosterSeen = new Set<string>();
  for (const accountId of roster) {
    if (rosterSeen.has(accountId)) throw new Error(`Conta duplicada no roster: ${accountId}`);
    rosterSeen.add(accountId);
  }
  for (const accountId of input.eligibleAccountIds) {
    if (!rosterSeen.has(accountId)) throw new Error(`Conta elegível fora do roster: ${accountId}`);
  }
  const itemsSeen = new Set<string>();
  for (const item of items) {
    if (itemsSeen.has(item.id)) throw new Error(`Item duplicado no manifesto: ${item.id}`);
    itemsSeen.add(item.id);
    if (!Number.isInteger(item.quantity) || item.quantity < 1) {
      throw new Error(`Quantidade inválida no manifesto: ${item.id}`);
    }
  }

  // Roster order, not the caller's: two different orderings of the same accounts must
  // still produce the same manifest.
  const eligibleIds = new Set(input.eligibleAccountIds);
  const eligible = roster.filter((accountId) => eligibleIds.has(accountId));
  const startCursor = eligible.length > 0 ? mod(input.startCursor ?? 0, eligible.length) : 0;

  const destinations: ManifestDestination[] = [];
  const losses: ManifestLoss[] = [];
  let cursor = startCursor;

  // Canonical order: which stack the rotating cursor reaches first must not depend on
  // the order the caller happened to collect `items` in.
  const orderedItems = [...items].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const item of orderedItems) {
    if (outcome !== 'extracted') {
      losses.push({ ...sourceFields(item), accountId: item.owner, reason: 'mission_failed' });
      continue;
    }
    if (item.owner !== null) {
      if (eligibleIds.has(item.owner)) {
        destinations.push({ ...sourceFields(item), accountId: item.owner });
      } else {
        losses.push({ ...sourceFields(item), accountId: item.owner, reason: 'not_eligible' });
      }
      continue;
    }
    if (eligible.length === 0) {
      losses.push({ ...sourceFields(item), accountId: null, reason: 'no_recipients' });
      continue;
    }
    const base = Math.floor(item.quantity / eligible.length);
    const remainder = item.quantity % eligible.length;
    for (let offset = 0; offset < eligible.length; offset++) {
      const share = base + (offset < remainder ? 1 : 0);
      if (share <= 0) continue;
      const recipient = eligible[(cursor + offset) % eligible.length] as string;
      destinations.push({ ...sourceFields(item), accountId: recipient, quantity: share });
    }
    cursor = mod(cursor + 1, eligible.length);
  }

  // Sorted by content, not insertion order: the manifest must not depend on the order
  // `items` happened to be collected in, so a retry producing the same items always
  // reaches the same manifest, including its hash.
  destinations.sort(byKey);
  losses.sort(byKey);

  return {
    expeditionId,
    catalogVersion: CATALOG_VERSION,
    outcome,
    roster: [...roster],
    eligibleAccountIds: eligible,
    startCursor,
    destinations,
    losses,
  };
}

function byKey(
  a: { readonly sourceId: string; readonly accountId: string | null },
  b: { readonly sourceId: string; readonly accountId: string | null },
): number {
  if (a.sourceId !== b.sourceId) return a.sourceId < b.sourceId ? -1 : 1;
  const left = a.accountId ?? '';
  const right = b.accountId ?? '';
  return left < right ? -1 : left > right ? 1 : 0;
}

function sourceFields(item: ManifestSourceItem) {
  return { sourceId: item.id, itemId: item.itemId, quantity: item.quantity, origin: item.origin };
}

function mod(value: number, size: number): number {
  return ((value % size) + size) % size;
}

/** Stable hash of a manifest: same content hashes the same, whatever the key order. */
export function manifestHash(manifest: Manifest): string {
  return createHash('sha256').update(canonicalJson(manifest)).digest('hex');
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a < b ? -1 : a > b ? 1 : 0,
    );
    const body = entries
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(',');
    return `{${body}}`;
  }
  return JSON.stringify(value);
}
