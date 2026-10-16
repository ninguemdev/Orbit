import { randomUUID } from 'node:crypto';
import { PartyErrorCode } from '@orbit/contracts';
import {
  type Database,
  type ExpeditionState,
  PREPARE_SECONDS,
  type StartExpeditionRefusal,
  cancelPreparation,
  findPreparationByStartKey,
  listPreparingExpeditions,
  startExpedition,
} from '@orbit/database';
import { errorName } from '../../infrastructure/error-name';

export interface PartyExpeditionRequest {
  /** Identifies one confirmation within this process, e.g. `<party room>:<revision>`. */
  readonly partyKey: string;
  readonly leaderAccountId: string;
  readonly shipId: string;
  readonly members: readonly {
    readonly accountId: string;
    readonly classId: string;
    readonly loadout: readonly { readonly slot: string; readonly instanceId: string }[];
  }[];
}

export type PartyExpeditionStart =
  | {
      readonly ok: true;
      readonly expeditionId: string;
      readonly state: ExpeditionState;
      /** Deadline on this process's clock (`Date.now()` scale). */
      readonly prepareDeadline: number;
    }
  | { readonly ok: false; readonly code: PartyErrorCode };

/** What the party room needs from expeditions; tests without a database omit it. */
export interface ExpeditionStarter {
  /**
   * Reserves the confirmed loadouts in a PREPARING expedition. `onExpired` runs if the
   * preparation is cancelled at its deadline (the items are already back).
   */
  start(
    request: PartyExpeditionRequest,
    onExpired: (expeditionId: string) => void,
  ): Promise<PartyExpeditionStart>;
  /**
   * Cancels a preparation and returns its items. Resolves true once that is committed
   * (or nothing was left to cancel); false when the database failed and it is retried.
   */
  cancel(expeditionId: string): Promise<boolean>;
}

const REFUSAL: Readonly<Record<StartExpeditionRefusal | 'expedition_ended', PartyErrorCode>> = {
  already_in_expedition: PartyErrorCode.MemberInExpedition,
  // The party learns about these changes and moves to a new revision.
  class_changed: PartyErrorCode.StaleRevision,
  loadout_changed: PartyErrorCode.StaleRevision,
  loadout_invalid: PartyErrorCode.LoadoutInvalid,
  ship_unavailable: PartyErrorCode.ShipUnavailable,
  // A party never builds these requests; answered as unavailable and logged.
  invalid_request: PartyErrorCode.PreparationUnavailable,
  no_account: PartyErrorCode.PreparationUnavailable,
  key_reused: PartyErrorCode.PreparationUnavailable,
  expedition_ended: PartyErrorCode.StaleRevision,
};

/** Retry delay when the database cannot cancel a preparation. */
const CANCEL_RETRY_MS = 5000;

export interface ExpeditionServiceOptions {
  readonly prepareSeconds?: number;
  readonly now?: () => number;
}

/**
 * Starts expeditions for confirmed parties and owns the preparation deadline: a
 * PREPARING expedition that does not become active in time is cancelled here and its
 * reservations returned. Deadlines come from the database as time left, so they do
 * not depend on clock differences between hosts.
 */
export class ExpeditionService implements ExpeditionStarter {
  readonly #db: Database;
  readonly #prepareSeconds: number | undefined;
  readonly #now: () => number;
  /** Start keys of this process cannot collide with those of a previous one. */
  readonly #bootId = randomUUID();
  readonly #timers = new Map<string, ReturnType<typeof setTimeout>>();
  readonly #onExpired = new Map<string, (expeditionId: string) => void>();
  /** Cancellations running now; shutdown waits for them before closing the pool. */
  readonly #running = new Set<Promise<unknown>>();
  #closed = false;

  constructor(db: Database, options: ExpeditionServiceOptions = {}) {
    this.#db = db;
    this.#prepareSeconds = options.prepareSeconds;
    this.#now = options.now ?? Date.now;
  }

  async start(
    request: PartyExpeditionRequest,
    onExpired: (expeditionId: string) => void,
  ): Promise<PartyExpeditionStart> {
    const startKey = `${this.#bootId}:${request.partyKey}`;
    let result;
    try {
      result = await startExpedition(this.#db, {
        startKey,
        leaderAccountId: request.leaderAccountId,
        shipId: request.shipId,
        members: request.members,
        ...(this.#prepareSeconds !== undefined ? { prepareSeconds: this.#prepareSeconds } : {}),
      });
    } catch (error) {
      // The commit may have happened with the answer lost: whatever this key created
      // is cancelled at its deadline like any other preparation.
      this.#sweepKey(startKey, (this.#prepareSeconds ?? PREPARE_SECONDS) * 1000);
      throw error;
    }
    if (!result.ok) {
      if (REFUSAL[result.reason] === PartyErrorCode.PreparationUnavailable) {
        console.error(`[expedition] início recusado: ${result.reason}`);
      }
      return { ok: false, code: REFUSAL[result.reason] };
    }
    const deadline = this.#now() + result.prepareRemainingMs;
    if (result.state === 'PREPARING') {
      this.#onExpired.set(result.expeditionId, onExpired);
      this.#schedule(result.expeditionId, result.prepareRemainingMs);
    }
    return {
      ok: true,
      expeditionId: result.expeditionId,
      state: result.state,
      prepareDeadline: deadline,
    };
  }

  async cancel(expeditionId: string): Promise<boolean> {
    this.#onExpired.delete(expeditionId);
    this.#clearTimer(expeditionId);
    // On failure the cancellation is retried by the same path as an expired deadline,
    // so the items never stay reserved for a preparation nobody is waiting for.
    return this.#track(this.#expire(expeditionId));
  }

  /**
   * After a restart no PREPARING expedition has a room: each one is cancelled at its
   * deadline (at once if it already passed). Returns how many were found.
   */
  async recoverPreparations(): Promise<number> {
    const pending = await listPreparingExpeditions(this.#db);
    for (const { expeditionId, remainingMs } of pending) this.#schedule(expeditionId, remainingMs);
    return pending.length;
  }

  /**
   * Waits for running cancellations, then stops the timers (server shutdown, tests).
   * Preparations still pending are cancelled by the next process's recovery.
   */
  async close(): Promise<void> {
    this.#closed = true;
    for (const timer of this.#timers.values()) clearTimeout(timer);
    this.#timers.clear();
    this.#onExpired.clear();
    await Promise.allSettled([...this.#running]);
  }

  #schedule(expeditionId: string, delayMs: number): void {
    if (this.#closed) return;
    this.#clearTimer(expeditionId);
    const timer = setTimeout(() => void this.#track(this.#expire(expeditionId)), delayMs);
    timer.unref();
    this.#timers.set(expeditionId, timer);
  }

  #clearTimer(expeditionId: string): void {
    const timer = this.#timers.get(expeditionId);
    if (timer) clearTimeout(timer);
    this.#timers.delete(expeditionId);
  }

  #track<T>(work: Promise<T>): Promise<T> {
    this.#running.add(work);
    void work.finally(() => this.#running.delete(work));
    return work;
  }

  async #expire(expeditionId: string): Promise<boolean> {
    this.#timers.delete(expeditionId);
    try {
      const result = await cancelPreparation(this.#db, expeditionId);
      const listener = this.#onExpired.get(expeditionId);
      this.#onExpired.delete(expeditionId);
      if (result === 'cancelled') listener?.(expeditionId);
      return true;
    } catch (error) {
      console.error(`[expedition] não foi possível cancelar a preparação: ${errorName(error)}`);
      this.#schedule(expeditionId, CANCEL_RETRY_MS);
      return false;
    }
  }

  /** Finds what a start whose answer was lost created, and cancels it at its deadline. */
  #sweepKey(startKey: string, delayMs: number): void {
    if (this.#closed) return;
    const timer = setTimeout(() => {
      if (this.#closed) return;
      void this.#track(
        (async () => {
          try {
            const pending = await findPreparationByStartKey(this.#db, startKey);
            if (pending) this.#schedule(pending.expeditionId, pending.remainingMs);
          } catch (error) {
            console.error(`[expedition] não foi possível conferir o início: ${errorName(error)}`);
            this.#sweepKey(startKey, CANCEL_RETRY_MS);
          }
        })(),
      );
    }, delayMs);
    timer.unref();
  }
}
