import { and, asc, eq, inArray } from 'drizzle-orm';
import {
  type ClassId,
  type LoadoutIssue,
  isClassId,
  isLoadoutSlot,
  loadoutItemIssue,
} from '@orbit/catalog';
import type { Database } from '../client';
import { activeParticipations, itemInstances, loadoutItems, profiles } from '../schema';
import { type Executor, lockAccount } from './inventory';

export interface LoadoutPick {
  readonly slot: string;
  readonly instanceId: string;
}

export interface LoadoutEntry {
  readonly slot: string;
  readonly instanceId: string;
  readonly itemId: string;
  readonly quantity: number;
  /** Set when the entry no longer fits the rules (e.g. the class changed). */
  readonly issue: LoadoutIssue | null;
}

export interface Loadout {
  readonly classId: ClassId | null;
  readonly entries: readonly LoadoutEntry[];
}

export interface SlotIssue {
  readonly slot: string;
  readonly issue: LoadoutIssue;
}

export type SetLoadoutResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly issues: readonly SlotIssue[] }
  | {
      readonly ok: false;
      readonly issues: null;
      readonly reason: 'no_account' | 'in_expedition';
    };

async function classOf(tx: Executor, accountId: string): Promise<ClassId | null> {
  const [row] = await tx
    .select({ classId: profiles.classId })
    .from(profiles)
    .where(eq(profiles.accountId, accountId));
  return row?.classId && isClassId(row.classId) ? row.classId : null;
}

/**
 * The account's loadout, checked against the current class: a class change can make
 * a saved entry invalid, and the entry then carries the issue instead of vanishing.
 */
export async function getLoadout(db: Database, accountId: string): Promise<Loadout> {
  return db.transaction(
    async (tx) => {
      const classId = await classOf(tx, accountId);
      const rows = await tx
        .select({
          slot: loadoutItems.slot,
          instanceId: itemInstances.id,
          itemId: itemInstances.itemId,
          quantity: itemInstances.quantity,
        })
        .from(loadoutItems)
        .innerJoin(itemInstances, eq(itemInstances.id, loadoutItems.itemInstanceId))
        .where(eq(loadoutItems.accountId, accountId))
        .orderBy(asc(loadoutItems.slot));
      return {
        classId,
        entries: rows.map((row) => ({
          ...row,
          issue: loadoutItemIssue(row.itemId, row.slot, classId),
        })),
      };
    },
    { isolationLevel: 'repeatable read', accessMode: 'read only' },
  );
}

/**
 * Replaces the whole loadout of the session's account. Every pick must be an item of
 * this account that is in its stash, fit the slot and the class; otherwise nothing
 * changes and each refused slot is reported. The stash itself is never modified.
 * `issues: null` means the account no longer exists or is in an expedition: the loadout
 * of an expedition is reserved and its snapshot is what the match uses, so it does not
 * change until the expedition ends.
 */
export async function setLoadout(
  db: Database,
  accountId: string,
  picks: readonly LoadoutPick[],
): Promise<SetLoadoutResult> {
  return db.transaction(async (tx): Promise<SetLoadoutResult> => {
    if (!(await lockAccount(tx, accountId))) {
      return { ok: false, issues: null, reason: 'no_account' };
    }
    const [participation] = await tx
      .select({ expeditionId: activeParticipations.expeditionId })
      .from(activeParticipations)
      .where(eq(activeParticipations.accountId, accountId));
    if (participation) return { ok: false, issues: null, reason: 'in_expedition' };
    const classId = await classOf(tx, accountId);
    const ids = [...new Set(picks.map((pick) => pick.instanceId))];
    // Only this account's stash is searched: another account's item, an inbox item
    // and an unknown ID all look the same, "not owned".
    const owned =
      ids.length === 0
        ? []
        : await tx
            .select({ id: itemInstances.id, itemId: itemInstances.itemId })
            .from(itemInstances)
            .where(
              and(
                inArray(itemInstances.id, ids),
                eq(itemInstances.ownerAccountId, accountId),
                eq(itemInstances.location, 'stash'),
              ),
            );
    const itemOf = new Map(owned.map((row) => [row.id, row.itemId]));

    const issues: SlotIssue[] = [];
    const slots = new Set<string>();
    const items = new Set<string>();
    for (const pick of picks) {
      const itemId = itemOf.get(pick.instanceId);
      let issue: LoadoutIssue | null;
      if (!isLoadoutSlot(pick.slot)) issue = 'invalid_slot';
      else if (slots.has(pick.slot)) issue = 'duplicate_slot';
      else if (items.has(pick.instanceId)) issue = 'duplicate_item';
      else if (itemId === undefined) issue = 'not_owned';
      else issue = loadoutItemIssue(itemId, pick.slot, classId);
      slots.add(pick.slot);
      items.add(pick.instanceId);
      if (issue) issues.push({ slot: pick.slot, issue });
    }
    if (issues.length > 0) return { ok: false, issues };

    await tx.delete(loadoutItems).where(eq(loadoutItems.accountId, accountId));
    if (picks.length > 0) {
      await tx
        .insert(loadoutItems)
        .values(
          picks.map((pick) => ({ accountId, slot: pick.slot, itemInstanceId: pick.instanceId })),
        );
    }
    return { ok: true };
  });
}
