import { createHash } from 'node:crypto';
import { and, eq, inArray, sql } from 'drizzle-orm';
import {
  CATALOG_VERSION,
  type ClassId,
  LOADOUT_SLOTS,
  isClassId,
  loadoutItemIssue,
} from '@orbit/catalog';
import { PARTY_MAX_MEMBERS } from '@orbit/contracts';
import type { Database } from '../client';
import { type Executor, lockAccount } from '../inventory/inventory';
import type { LoadoutPick } from '../inventory/loadout';
import {
  type ExpeditionState,
  activeParticipations,
  expeditionMembers,
  expeditions,
  itemInstances,
  itemReservations,
  loadoutItems,
  profiles,
  shipUnlocks,
} from '../schema';

/** Time the party has to load into the match before the preparation is cancelled (docs/06). */
export const PREPARE_SECONDS = 30;

export interface ExpeditionMemberRequest {
  readonly accountId: string;
  /** Class the party showed; must still be the class saved in the profile. */
  readonly classId: string;
  /** Loadout the leader confirmed; must still be the loadout saved for the account. */
  readonly loadout: readonly LoadoutPick[];
}

export interface StartExpeditionRequest {
  /**
   * Idempotency key chosen by the server for one confirmation. The same key with the
   * same request returns the expedition already created; with another request it is
   * refused.
   */
  readonly startKey: string;
  readonly leaderAccountId: string;
  readonly shipId: string;
  readonly members: readonly ExpeditionMemberRequest[];
  readonly prepareSeconds?: number;
}

export type StartExpeditionRefusal =
  | 'invalid_request'
  | 'no_account'
  | 'key_reused'
  | 'already_in_expedition'
  | 'class_changed'
  | 'loadout_changed'
  | 'loadout_invalid'
  | 'ship_unavailable';

export type StartExpeditionResult =
  | {
      readonly ok: true;
      readonly expeditionId: string;
      readonly state: ExpeditionState;
      /** False when this call is a retry of a request already recorded. */
      readonly created: boolean;
      readonly prepareDeadlineAt: Date;
    }
  | {
      readonly ok: false;
      readonly reason: StartExpeditionRefusal;
      /** Members the refusal is about (empty when it concerns the whole request). */
      readonly accountIds: readonly string[];
    };

export interface ReservedItem {
  readonly slot: string;
  readonly instanceId: string;
  readonly itemId: string;
  readonly quantity: number;
}

const slotOrder = (slot: string) => (LOADOUT_SLOTS as readonly string[]).indexOf(slot);
const bySlot = (a: { slot: string }, b: { slot: string }) => slotOrder(a.slot) - slotOrder(b.slot);

/** Hash of everything the request asks for, in a canonical order. */
function requestHash(request: StartExpeditionRequest): string {
  const canonical = {
    leader: request.leaderAccountId,
    ship: request.shipId,
    members: [...request.members]
      .sort((a, b) => a.accountId.localeCompare(b.accountId))
      .map((member) => ({
        accountId: member.accountId,
        classId: member.classId,
        loadout: [...member.loadout].sort(bySlot).map((pick) => [pick.slot, pick.instanceId]),
      })),
  };
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

function isWellFormed(request: StartExpeditionRequest): boolean {
  const ids = request.members.map((member) => member.accountId);
  const seconds = request.prepareSeconds ?? PREPARE_SECONDS;
  return (
    request.startKey.length >= 1 &&
    request.startKey.length <= 200 &&
    ids.length >= 1 &&
    ids.length <= PARTY_MAX_MEMBERS &&
    new Set(ids).size === ids.length &&
    ids.includes(request.leaderAccountId) &&
    Number.isInteger(seconds) &&
    seconds > 0
  );
}

const refuse = (
  reason: StartExpeditionRefusal,
  accountIds: readonly string[] = [],
): StartExpeditionResult => ({ ok: false, reason, accountIds });

/** The expedition recorded for a start key, compared with this request. */
async function existing(
  tx: Executor,
  request: StartExpeditionRequest,
  hash: string,
): Promise<StartExpeditionResult | null> {
  const [row] = await tx
    .select({
      id: expeditions.id,
      state: expeditions.state,
      requestHash: expeditions.requestHash,
      prepareDeadlineAt: expeditions.prepareDeadlineAt,
    })
    .from(expeditions)
    .where(eq(expeditions.startKey, request.startKey));
  if (!row) return null;
  if (row.requestHash !== hash) return refuse('key_reused');
  return {
    ok: true,
    expeditionId: row.id,
    state: row.state as ExpeditionState,
    created: false,
    prepareDeadlineAt: row.prepareDeadlineAt,
  };
}

/**
 * Creates a PREPARING expedition for a confirmed party and reserves every member's
 * loadout, all in one transaction: either everything is recorded or nothing is.
 *
 * The member accounts are locked in a stable order (the same lock every inventory
 * change takes), so two starts sharing a member run one after the other and the
 * second finds the member already in an expedition. Under the locks the server
 * checks again what the party showed: the saved class, the saved loadout (the exact
 * items confirmed, still in the owner's stash and valid for the class) and that the
 * ship is licensed to a member. Nothing in the request is trusted beyond the IDs.
 */
export async function startExpedition(
  db: Database,
  request: StartExpeditionRequest,
): Promise<StartExpeditionResult> {
  if (!isWellFormed(request)) return refuse('invalid_request');
  const hash = requestHash(request);
  const accountIds = request.members.map((member) => member.accountId).sort();

  return db.transaction(async (tx): Promise<StartExpeditionResult> => {
    for (const accountId of accountIds) {
      if (!(await lockAccount(tx, accountId))) return refuse('no_account', [accountId]);
    }
    // A retry is answered before anything else: by now the members are in the
    // expedition it created, which would otherwise look like a conflict.
    const retry = await existing(tx, request, hash);
    if (retry) return retry;

    const busy = await tx
      .select({ accountId: activeParticipations.accountId })
      .from(activeParticipations)
      .where(inArray(activeParticipations.accountId, accountIds));
    if (busy.length > 0) {
      return refuse(
        'already_in_expedition',
        busy.map((row) => row.accountId),
      );
    }

    const classes = await tx
      .select({ accountId: profiles.accountId, classId: profiles.classId })
      .from(profiles)
      .where(inArray(profiles.accountId, accountIds));
    const savedClass = new Map(classes.map((row) => [row.accountId, row.classId]));
    const classOf = new Map<string, ClassId>();
    for (const member of request.members) {
      if (isClassId(member.classId) && savedClass.get(member.accountId) === member.classId) {
        classOf.set(member.accountId, member.classId);
      }
    }
    const classChanged = accountIds.filter((accountId) => !classOf.has(accountId));
    if (classChanged.length > 0) return refuse('class_changed', classChanged);

    const saved = await tx
      .select({
        accountId: loadoutItems.accountId,
        slot: loadoutItems.slot,
        instanceId: itemInstances.id,
        itemId: itemInstances.itemId,
        quantity: itemInstances.quantity,
      })
      .from(loadoutItems)
      .innerJoin(itemInstances, eq(itemInstances.id, loadoutItems.itemInstanceId))
      .where(inArray(loadoutItems.accountId, accountIds));
    const loadouts = new Map<string, ReservedItem[]>();
    for (const row of saved) {
      const list = loadouts.get(row.accountId) ?? [];
      list.push(row);
      loadouts.set(row.accountId, list);
    }
    const changed: string[] = [];
    const invalid: string[] = [];
    for (const member of request.members) {
      const items = (loadouts.get(member.accountId) ?? []).sort(bySlot);
      const asked = [...member.loadout].sort(bySlot);
      const same =
        items.length === asked.length &&
        items.every(
          (item, index) =>
            item.slot === asked[index]?.slot && item.instanceId === asked[index]?.instanceId,
        );
      if (!same) changed.push(member.accountId);
      else {
        const classId = classOf.get(member.accountId) ?? null;
        if (items.some((item) => loadoutItemIssue(item.itemId, item.slot, classId) !== null)) {
          invalid.push(member.accountId);
        }
      }
    }
    if (changed.length > 0) return refuse('loadout_changed', changed);
    if (invalid.length > 0) return refuse('loadout_invalid', invalid);

    const [license] = await tx
      .select({ accountId: shipUnlocks.accountId })
      .from(shipUnlocks)
      .where(
        and(inArray(shipUnlocks.accountId, accountIds), eq(shipUnlocks.shipId, request.shipId)),
      )
      .limit(1);
    if (!license) return refuse('ship_unavailable');

    const seconds = request.prepareSeconds ?? PREPARE_SECONDS;
    const [created] = await tx
      .insert(expeditions)
      .values({
        startKey: request.startKey,
        requestHash: hash,
        leaderAccountId: request.leaderAccountId,
        shipId: request.shipId,
        catalogVersion: CATALOG_VERSION,
        prepareDeadlineAt: sql`now() + make_interval(secs => ${seconds})`,
      })
      .onConflictDoNothing({ target: expeditions.startKey })
      .returning({ id: expeditions.id, prepareDeadlineAt: expeditions.prepareDeadlineAt });
    // The key was taken by a request for other accounts that committed meanwhile.
    if (!created) return (await existing(tx, request, hash)) ?? refuse('key_reused');

    await tx.insert(expeditionMembers).values(
      request.members.map((member) => ({
        expeditionId: created.id,
        accountId: member.accountId,
        classId: member.classId,
        loadout: (loadouts.get(member.accountId) ?? []).map(
          ({ slot, instanceId, itemId, quantity }) => ({ slot, instanceId, itemId, quantity }),
        ),
      })),
    );
    await tx
      .insert(activeParticipations)
      .values(accountIds.map((accountId) => ({ accountId, expeditionId: created.id })));
    const reserved = request.members.flatMap((member) =>
      (loadouts.get(member.accountId) ?? []).map((item) => ({
        itemInstanceId: item.instanceId,
        expeditionId: created.id,
        accountId: member.accountId,
        slot: item.slot,
        quantity: item.quantity,
      })),
    );
    if (reserved.length > 0) await tx.insert(itemReservations).values(reserved);

    return {
      ok: true,
      expeditionId: created.id,
      state: 'PREPARING',
      created: true,
      prepareDeadlineAt: created.prepareDeadlineAt,
    };
  });
}

export type CancelPreparationResult = 'cancelled' | 'not_preparing' | 'not_found';

/**
 * Cancels an expedition that never became active: its reservations and the members'
 * participations are removed in one transaction, so the items are available again.
 * Calling it again, or on an expedition that already started, changes nothing.
 */
export async function cancelPreparation(
  db: Database,
  expeditionId: string,
): Promise<CancelPreparationResult> {
  return db.transaction(async (tx): Promise<CancelPreparationResult> => {
    const members = await tx
      .select({ accountId: expeditionMembers.accountId })
      .from(expeditionMembers)
      .where(eq(expeditionMembers.expeditionId, expeditionId));
    // Same order as startExpedition: accounts first, then the expedition.
    const accountIds = members.map((member) => member.accountId).sort();
    for (const accountId of accountIds) await lockAccount(tx, accountId);
    const rows = await tx.execute<{ state: string }>(
      sql`SELECT ${expeditions.state} AS state FROM ${expeditions}
          WHERE ${expeditions.id} = ${expeditionId} FOR UPDATE`,
    );
    const state = rows.rows[0]?.state;
    if (state === undefined) return 'not_found';
    if (state !== 'PREPARING') return 'not_preparing';

    await tx.delete(itemReservations).where(eq(itemReservations.expeditionId, expeditionId));
    await tx
      .delete(activeParticipations)
      .where(eq(activeParticipations.expeditionId, expeditionId));
    await tx
      .update(expeditions)
      .set({ state: 'CANCELLED', endedAt: sql`now()` })
      .where(eq(expeditions.id, expeditionId));
    return 'cancelled';
  });
}

export interface ActiveExpedition {
  readonly expeditionId: string;
  readonly state: ExpeditionState;
  readonly prepareDeadlineAt: Date;
  readonly reserved: readonly ReservedItem[];
}

/** The expedition the account is in right now, with the items it reserved. */
export async function getActiveExpedition(
  db: Database,
  accountId: string,
): Promise<ActiveExpedition | null> {
  return db.transaction(
    async (tx) => {
      const [row] = await tx
        .select({
          expeditionId: expeditions.id,
          state: expeditions.state,
          prepareDeadlineAt: expeditions.prepareDeadlineAt,
        })
        .from(activeParticipations)
        .innerJoin(expeditions, eq(expeditions.id, activeParticipations.expeditionId))
        .where(eq(activeParticipations.accountId, accountId));
      if (!row) return null;
      const reserved = await tx
        .select({
          slot: itemReservations.slot,
          instanceId: itemInstances.id,
          itemId: itemInstances.itemId,
          quantity: itemReservations.quantity,
        })
        .from(itemReservations)
        .innerJoin(itemInstances, eq(itemInstances.id, itemReservations.itemInstanceId))
        .where(
          and(
            eq(itemReservations.accountId, accountId),
            eq(itemReservations.expeditionId, row.expeditionId),
          ),
        );
      return { ...row, state: row.state as ExpeditionState, reserved: reserved.sort(bySlot) };
    },
    { isolationLevel: 'repeatable read', accessMode: 'read only' },
  );
}
