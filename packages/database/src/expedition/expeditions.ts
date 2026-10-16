import { createHash } from 'node:crypto';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import {
  CATALOG_VERSION,
  type ClassId,
  LOADOUT_SLOTS,
  isClassId,
  loadoutItemIssue,
} from '@orbit/catalog';
import { PARTY_MAX_MEMBERS } from '@orbit/contracts';
import type { Database } from '../client';
import { type Executor, lockAccounts } from '../inventory/inventory';
import type { LoadoutPick } from '../inventory/loadout';
import {
  type ExpeditionState,
  TERMINAL_EXPEDITION_STATES,
  accounts,
  activeParticipations,
  expeditionMembers,
  expeditions,
  itemInstances,
  itemReservations,
  loadoutItems,
  profiles,
  shipUnlocks,
} from '../schema';

export type { ExpeditionState } from '../schema';

/** Time the party has to load into the match before the preparation is cancelled (docs/06). */
export const PREPARE_SECONDS = 30;
/** Longest preparation a caller may ask for. */
export const MAX_PREPARE_SECONDS = 600;

/** Account IDs as the database writes them (lowercase), so sorting and comparing agree. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

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
      /** Time left until the deadline, measured by the database clock (no host skew). */
      readonly prepareRemainingMs: number;
    }
  | {
      readonly ok: false;
      readonly reason: StartExpeditionRefusal;
      /** Members the refusal is about (empty when it concerns the whole request). */
      readonly accountIds: readonly string[];
    }
  | {
      /** A retry of a request whose expedition already ended (e.g. its preparation expired). */
      readonly ok: false;
      readonly reason: 'expedition_ended';
      readonly expeditionId: string;
      readonly state: ExpeditionState;
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
/** Code-unit order, independent of locale; matches the database order of lowercase UUIDs. */
const byCodeUnit = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Hash of everything the request asks for, in a canonical order. */
function requestHash(request: StartExpeditionRequest): string {
  const canonical = {
    leader: request.leaderAccountId,
    ship: request.shipId,
    members: [...request.members]
      .sort((a, b) => byCodeUnit(a.accountId, b.accountId))
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
    ids.every((id) => UUID.test(id)) &&
    new Set(ids).size === ids.length &&
    ids.includes(request.leaderAccountId) &&
    Number.isInteger(seconds) &&
    seconds > 0 &&
    seconds <= MAX_PREPARE_SECONDS
  );
}

/** Milliseconds until the preparation deadline, by the database clock. */
const remainingMs = () =>
  sql<number>`greatest(0, extract(epoch from (${expeditions.prepareDeadlineAt} - now())) * 1000)::float8`;

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
      remainingMs: remainingMs(),
    })
    .from(expeditions)
    .where(eq(expeditions.startKey, request.startKey));
  if (!row) return null;
  if (row.requestHash !== hash) return refuse('key_reused');
  const state = row.state as ExpeditionState;
  if ((TERMINAL_EXPEDITION_STATES as readonly string[]).includes(state)) {
    return { ok: false, reason: 'expedition_ended', expeditionId: row.id, state, accountIds: [] };
  }
  return {
    ok: true,
    expeditionId: row.id,
    state,
    created: false,
    prepareDeadlineAt: row.prepareDeadlineAt,
    prepareRemainingMs: row.remainingMs,
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
  const accountIds = request.members.map((member) => member.accountId).sort(byCodeUnit);

  return db.transaction(async (tx): Promise<StartExpeditionResult> => {
    const missing = await lockAccounts(tx, accountIds);
    if (missing.length > 0) return refuse('no_account', missing);
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
    if (!created) {
      // The key was taken by a request for other accounts that committed meanwhile
      // (ON CONFLICT waits for it); in READ COMMITTED this statement sees that row.
      const taken = await existing(tx, request, hash);
      if (!taken) throw new Error('Chave de início em conflito sem expedição visível');
      return taken;
    }

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
      prepareRemainingMs: seconds * 1000,
    };
  });
}

export type CancelPreparationResult = 'cancelled' | 'not_preparing' | 'not_found';

/**
 * Ends an expedition in `from` as `to`, returning every reservation and ending the
 * members' participations in one transaction. Nothing is granted or consumed: the
 * reserved items never left the stash. Returns the state found, or null if none.
 */
async function endReturningItems(
  db: Database,
  expeditionId: string,
  from: readonly ExpeditionState[],
  to: ExpeditionState,
): Promise<{ readonly ended: boolean } | null> {
  if (!UUID.test(expeditionId)) return null;
  return db.transaction(async (tx) => {
    const members = await tx
      .select({ accountId: expeditionMembers.accountId })
      .from(expeditionMembers)
      .where(eq(expeditionMembers.expeditionId, expeditionId));
    // Same order as startExpedition: accounts first, then the expedition.
    await lockAccounts(
      tx,
      members.map((member) => member.accountId),
    );
    const rows = await tx.execute<{ state: string }>(
      sql`SELECT ${expeditions.state} AS state FROM ${expeditions}
          WHERE ${expeditions.id} = ${expeditionId} FOR UPDATE`,
    );
    const state = rows.rows[0]?.state;
    if (state === undefined) return null;
    if (!(from as readonly string[]).includes(state)) return { ended: false };

    await tx.delete(itemReservations).where(eq(itemReservations.expeditionId, expeditionId));
    await tx
      .delete(activeParticipations)
      .where(eq(activeParticipations.expeditionId, expeditionId));
    await tx
      .update(expeditions)
      .set({ state: to, endedAt: sql`now()` })
      .where(eq(expeditions.id, expeditionId));
    return { ended: true };
  });
}

/**
 * Cancels an expedition that never became active: its reservations and the members'
 * participations are removed in one transaction, so the items are available again.
 * Calling it again, or on an expedition that already started, changes nothing.
 */
export async function cancelPreparation(
  db: Database,
  expeditionId: string,
): Promise<CancelPreparationResult> {
  const result = await endReturningItems(db, expeditionId, ['PREPARING'], 'CANCELLED');
  if (!result) return 'not_found';
  return result.ended ? 'cancelled' : 'not_preparing';
}

export type AbortExpeditionResult = 'aborted' | 'not_running' | 'not_found';

/**
 * Technical abort of a running expedition (docs/12): the original reserved items go
 * back, nothing new is granted. Used for orphans of a previous process and, until
 * extraction and settlement exist (V03.05, V03.07), for a mission room that closes.
 */
export async function abortExpedition(
  db: Database,
  expeditionId: string,
): Promise<AbortExpeditionResult> {
  const result = await endReturningItems(
    db,
    expeditionId,
    ['ACTIVE', 'EXTRACTING'],
    'ABORTED_TECHNICAL',
  );
  if (!result) return 'not_found';
  return result.ended ? 'aborted' : 'not_running';
}

export type ActivateExpeditionResult = 'activated' | 'expired' | 'not_preparing';

/**
 * Starts the match: PREPARING becomes ACTIVE, only before the deadline (by the
 * database clock). A late activation leaves the expedition to be cancelled.
 */
export async function activateExpedition(
  db: Database,
  expeditionId: string,
): Promise<ActivateExpeditionResult> {
  if (!UUID.test(expeditionId)) return 'not_preparing';
  return db.transaction(async (tx): Promise<ActivateExpeditionResult> => {
    const rows = await tx.execute<{ state: string; in_time: boolean }>(
      sql`SELECT ${expeditions.state} AS state, ${expeditions.prepareDeadlineAt} > now() AS in_time
          FROM ${expeditions} WHERE ${expeditions.id} = ${expeditionId} FOR UPDATE`,
    );
    const row = rows.rows[0];
    if (row?.state !== 'PREPARING') return 'not_preparing';
    if (!row.in_time) return 'expired';
    await tx.update(expeditions).set({ state: 'ACTIVE' }).where(eq(expeditions.id, expeditionId));
    return 'activated';
  });
}

export interface ExpeditionRoster {
  readonly expeditionId: string;
  readonly state: ExpeditionState;
  readonly shipId: string;
  readonly leaderAccountId: string;
  readonly members: readonly {
    readonly accountId: string;
    readonly nick: string;
    readonly classId: string;
  }[];
}

/** Who takes part in an expedition, as recorded when it was created. */
export async function getExpeditionRoster(
  db: Database,
  expeditionId: string,
): Promise<ExpeditionRoster | null> {
  if (!UUID.test(expeditionId)) return null;
  return db.transaction(
    async (tx) => {
      const [row] = await tx
        .select({
          state: expeditions.state,
          shipId: expeditions.shipId,
          leaderAccountId: expeditions.leaderAccountId,
        })
        .from(expeditions)
        .where(eq(expeditions.id, expeditionId));
      if (!row) return null;
      const members = await tx
        .select({
          accountId: expeditionMembers.accountId,
          nick: accounts.nick,
          classId: expeditionMembers.classId,
        })
        .from(expeditionMembers)
        .innerJoin(accounts, eq(accounts.id, expeditionMembers.accountId))
        .where(eq(expeditionMembers.expeditionId, expeditionId))
        .orderBy(asc(accounts.nickNormalized));
      return { expeditionId, ...row, state: row.state as ExpeditionState, members };
    },
    { isolationLevel: 'repeatable read', accessMode: 'read only' },
  );
}

/** Expeditions running now (recovery: after a restart none of them has a room). */
export async function listRunningExpeditions(
  db: Database,
): Promise<{ readonly expeditionId: string; readonly startKey: string }[]> {
  return db
    .select({ expeditionId: expeditions.id, startKey: expeditions.startKey })
    .from(expeditions)
    .where(inArray(expeditions.state, ['ACTIVE', 'EXTRACTING']));
}

export interface PendingPreparation {
  readonly expeditionId: string;
  /** Names the process that started it (its boot ID is the prefix). */
  readonly startKey: string;
  /** Time left until the deadline by the database clock; 0 once it passed. */
  readonly remainingMs: number;
}

/** Expeditions still waiting to start, oldest deadline first (recovery after a restart). */
export async function listPreparingExpeditions(db: Database): Promise<PendingPreparation[]> {
  return db
    .select({
      expeditionId: expeditions.id,
      startKey: expeditions.startKey,
      remainingMs: remainingMs(),
    })
    .from(expeditions)
    .where(eq(expeditions.state, 'PREPARING'))
    .orderBy(asc(expeditions.prepareDeadlineAt));
}

/** The PREPARING expedition recorded for a start key, if any (cleanup after a lost answer). */
export async function findPreparationByStartKey(
  db: Database,
  startKey: string,
): Promise<PendingPreparation | null> {
  const [row] = await db
    .select({
      expeditionId: expeditions.id,
      startKey: expeditions.startKey,
      remainingMs: remainingMs(),
    })
    .from(expeditions)
    .where(and(eq(expeditions.startKey, startKey), eq(expeditions.state, 'PREPARING')));
  return row ?? null;
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
