import { randomUUID } from 'node:crypto';
import { PartyErrorCode } from '@orbit/contracts';
import {
  type ActivateExpeditionResult,
  type Database,
  type ExpeditionRoster,
  type ExpeditionState,
  PREPARE_SECONDS,
  type SettlementManifest,
  type StartExpeditionRefusal,
  abortExpedition,
  activateExpedition,
  cancelPreparation,
  findPreparationByStartKey,
  getExpeditionRoster,
  listPreparingExpeditions,
  listRunningExpeditions,
  settleExpedition,
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
      /** Stops delivering this expedition's events to the start's watcher. */
      readonly unwatch: () => void;
    }
  | { readonly ok: false; readonly code: PartyErrorCode };

/** Why a preparation ended without a match. */
export type CancelReason = 'expired' | 'party_changed' | 'room_closed';

/**
 * `cancelled`: committed, the items are back; `not_preparing`: nothing to cancel (it
 * already ended, or became active first); `retrying`: the database failed and the
 * cancellation will be tried again.
 */
export type CancelOutcome = 'cancelled' | 'not_preparing' | 'retrying';

/** Lifecycle events of one expedition, delivered after the database committed them. */
export interface ExpeditionWatcher {
  /** The preparation was cancelled and its items returned. */
  onCancelled?(reason: CancelReason): void;
  /** Every member loaded and the match started. */
  onActivated?(): void;
  /** The match extracted, was destroyed or timed out, and the manifest was persisted. */
  onSettled?(): void;
  /** The running match ended before a settlement and its reserved items went back. */
  onAborted?(): void;
}

/** What the party room needs from expeditions; tests without a database omit it. */
export interface ExpeditionStarter {
  /** Reserves the confirmed loadouts in a PREPARING expedition and watches it. */
  start(request: PartyExpeditionRequest, watcher: ExpeditionWatcher): Promise<PartyExpeditionStart>;
  /**
   * Cancels a preparation and returns its items. Once asked, the expedition can no
   * longer be activated by this process, even while the cancellation is retried.
   */
  cancel(expeditionId: string, reason: CancelReason): Promise<CancelOutcome>;
  /** Follows an expedition's events; returns the function that stops following. */
  watch(expeditionId: string, watcher: ExpeditionWatcher): () => void;
}

/** What the mission room needs from expeditions. */
export interface MissionLifecycle extends ExpeditionStarter {
  roster(expeditionId: string): Promise<ExpeditionRoster | null>;
  /** Starts the match if the preparation is still in time. */
  activate(expeditionId: string): Promise<ActivateExpeditionResult>;
  /** Ends a running match returning the reserved items; retried until committed. */
  abort(expeditionId: string): Promise<boolean>;
  /** Persists one extraction's manifest; retried until committed. */
  settle(expeditionId: string, manifest: SettlementManifest, manifestHash: string): Promise<boolean>;
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

/** Retry delay when the database cannot end an expedition. */
const RETRY_MS = 5000;

export interface ExpeditionServiceOptions {
  readonly prepareSeconds?: number;
}

/**
 * Starts expeditions for confirmed parties and owns their lifecycle until the match
 * ends: a PREPARING expedition that does not become active in time is cancelled here
 * and its reservations returned. Deadlines come from the database as time left, so
 * they do not depend on clock differences between hosts. Every event reaches the
 * watchers only after the database committed it.
 */
export class ExpeditionService implements MissionLifecycle {
  readonly #db: Database;
  readonly #prepareSeconds: number | undefined;
  /** Start keys of this process cannot collide with those of a previous one. */
  readonly #bootId = randomUUID();
  readonly #timers = new Map<string, ReturnType<typeof setTimeout>>();
  readonly #watchers = new Map<string, Set<ExpeditionWatcher>>();
  /** Preparations someone asked to cancel; they are never activated. */
  readonly #cancelling = new Set<string>();
  /** Database work running now; shutdown waits for it before closing the pool. */
  readonly #running = new Set<Promise<unknown>>();
  #closed = false;

  constructor(db: Database, options: ExpeditionServiceOptions = {}) {
    this.#db = db;
    this.#prepareSeconds = options.prepareSeconds;
  }

  async start(
    request: PartyExpeditionRequest,
    watcher: ExpeditionWatcher,
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
    const unwatch = this.watch(result.expeditionId, watcher);
    if (result.state === 'PREPARING') {
      this.#scheduleExpiry(result.expeditionId, result.prepareRemainingMs);
    }
    return {
      ok: true,
      expeditionId: result.expeditionId,
      state: result.state,
      prepareDeadline: Date.now() + result.prepareRemainingMs,
      unwatch,
    };
  }

  watch(expeditionId: string, watcher: ExpeditionWatcher): () => void {
    let set = this.#watchers.get(expeditionId);
    if (!set) {
      set = new Set();
      this.#watchers.set(expeditionId, set);
    }
    set.add(watcher);
    return () => {
      const current = this.#watchers.get(expeditionId);
      current?.delete(watcher);
      if (current?.size === 0) this.#watchers.delete(expeditionId);
    };
  }

  roster(expeditionId: string): Promise<ExpeditionRoster | null> {
    return getExpeditionRoster(this.#db, expeditionId);
  }

  cancel(expeditionId: string, reason: CancelReason): Promise<CancelOutcome> {
    this.#cancelling.add(expeditionId);
    this.#clearTimer(expeditionId);
    // On failure the cancellation is retried by the same path as an expired deadline,
    // so the items never stay reserved for a preparation nobody is waiting for.
    return this.#track(this.#cancel(expeditionId, reason));
  }

  async activate(expeditionId: string): Promise<ActivateExpeditionResult> {
    // A cancellation was asked for (it may still be retrying): the match must not start.
    if (this.#cancelling.has(expeditionId)) return 'not_preparing';
    const result = await this.#track(activateExpedition(this.#db, expeditionId));
    if (result === 'activated') {
      this.#clearTimer(expeditionId);
      this.#emit(expeditionId, (watcher) => watcher.onActivated?.());
    }
    return result;
  }

  abort(expeditionId: string): Promise<boolean> {
    return this.#track(this.#abort(expeditionId));
  }

  settle(
    expeditionId: string,
    manifest: SettlementManifest,
    manifestHash: string,
  ): Promise<boolean> {
    return this.#track(this.#settle(expeditionId, manifest, manifestHash));
  }

  /**
   * After a restart no expedition has a room (single process): preparations are
   * cancelled at their deadline and running matches aborted, both returning the
   * reserved items (docs/12). Returns how many were found.
   */
  async recover(): Promise<{ readonly preparing: number; readonly running: number }> {
    const [preparing, running] = await Promise.all([
      listPreparingExpeditions(this.#db),
      listRunningExpeditions(this.#db),
    ]);
    // Expeditions this process started have rooms and timers: a late retry of the
    // recovery must not touch them.
    const own = `${this.#bootId}:`;
    const orphanPreparing = preparing.filter((row) => !row.startKey.startsWith(own));
    const orphanRunning = running.filter((row) => !row.startKey.startsWith(own));
    for (const { expeditionId, remainingMs } of orphanPreparing) {
      this.#scheduleExpiry(expeditionId, remainingMs);
    }
    for (const { expeditionId } of orphanRunning) void this.abort(expeditionId);
    return { preparing: orphanPreparing.length, running: orphanRunning.length };
  }

  /**
   * Waits for running database work, then stops the timers (server shutdown, tests).
   * What is still pending is recovered by the next process.
   */
  async close(): Promise<void> {
    this.#closed = true;
    for (const timer of this.#timers.values()) clearTimeout(timer);
    this.#timers.clear();
    await Promise.allSettled([...this.#running]);
    this.#watchers.clear();
  }

  #emit(expeditionId: string, event: (watcher: ExpeditionWatcher) => void): void {
    for (const watcher of [...(this.#watchers.get(expeditionId) ?? [])]) {
      try {
        event(watcher);
      } catch (error) {
        console.error(`[expedition] observador falhou: ${errorName(error)}`);
      }
    }
  }

  #scheduleExpiry(expeditionId: string, delayMs: number): void {
    this.#later(expeditionId, delayMs, () => {
      this.#cancelling.add(expeditionId);
      return this.#cancel(expeditionId, 'expired');
    });
  }

  #later(expeditionId: string, delayMs: number, work: () => Promise<unknown>): void {
    if (this.#closed) return;
    this.#clearTimer(expeditionId);
    const timer = setTimeout(() => {
      this.#timers.delete(expeditionId);
      void this.#track(work());
    }, delayMs);
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
    void work.then(
      () => this.#running.delete(work),
      () => this.#running.delete(work),
    );
    return work;
  }

  async #cancel(expeditionId: string, reason: CancelReason): Promise<CancelOutcome> {
    try {
      const result = await cancelPreparation(this.#db, expeditionId);
      this.#cancelling.delete(expeditionId);
      if (result === 'cancelled') {
        this.#emit(expeditionId, (watcher) => watcher.onCancelled?.(reason));
        this.#watchers.delete(expeditionId);
        return 'cancelled';
      }
      return 'not_preparing';
    } catch (error) {
      console.error(`[expedition] não foi possível cancelar a preparação: ${errorName(error)}`);
      this.#cancelling.add(expeditionId);
      this.#later(expeditionId, RETRY_MS, () => this.#cancel(expeditionId, reason));
      return 'retrying';
    }
  }

  async #abort(expeditionId: string): Promise<boolean> {
    try {
      const result = await abortExpedition(this.#db, expeditionId);
      if (result === 'aborted') {
        this.#emit(expeditionId, (watcher) => watcher.onAborted?.());
        this.#watchers.delete(expeditionId);
      }
      return true;
    } catch (error) {
      console.error(`[expedition] não foi possível encerrar a expedição: ${errorName(error)}`);
      this.#later(expeditionId, RETRY_MS, () => this.#abort(expeditionId));
      return false;
    }
  }

  async #settle(
    expeditionId: string,
    manifest: SettlementManifest,
    manifestHash: string,
  ): Promise<boolean> {
    try {
      const result = await settleExpedition(this.#db, manifest, manifestHash);
      if (!result.ok) {
        // Not something a retry can fix: the expedition does not exist, or something
        // else already ended it (e.g. a previous process's recovery aborted it).
        console.error(`[expedition] liquidação recusada: ${result.reason}`);
        return true;
      }
      this.#emit(expeditionId, (watcher) => watcher.onSettled?.());
      this.#watchers.delete(expeditionId);
      return true;
    } catch (error) {
      console.error(`[expedition] não foi possível liquidar a expedição: ${errorName(error)}`);
      this.#later(expeditionId, RETRY_MS, () => this.#settle(expeditionId, manifest, manifestHash));
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
            if (pending) this.#scheduleExpiry(pending.expeditionId, pending.remainingMs);
          } catch (error) {
            console.error(`[expedition] não foi possível conferir o início: ${errorName(error)}`);
            this.#sweepKey(startKey, RETRY_MS);
          }
        })(),
      );
    }, delayMs);
    timer.unref();
  }
}
