import { randomUUID } from 'node:crypto';
import { PartyErrorCode } from '@orbit/contracts';
import {
  type Database,
  type StartExpeditionRefusal,
  cancelPreparation,
  listPreparingExpeditions,
  startExpedition,
} from '@orbit/database';

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
  | { readonly ok: true; readonly expeditionId: string; readonly prepareDeadline: number }
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
  /** Cancels a preparation and returns its items; does nothing once it started. */
  cancel(expeditionId: string): Promise<void>;
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

/** Retry delay when the database cannot cancel an expired preparation. */
const CANCEL_RETRY_MS = 5000;

export interface ExpeditionServiceOptions {
  readonly prepareSeconds?: number;
  readonly now?: () => number;
}

/**
 * Starts expeditions for confirmed parties and owns the preparation deadline: a
 * PREPARING expedition that does not become active in time is cancelled here and its
 * reservations returned. The only writer of expedition starts and cancellations.
 */
export class ExpeditionService implements ExpeditionStarter {
  readonly #db: Database;
  readonly #options: ExpeditionServiceOptions;
  /** Start keys of this process cannot collide with those of a previous one. */
  readonly #bootId = randomUUID();
  readonly #timers = new Map<string, ReturnType<typeof setTimeout>>();
  readonly #onExpired = new Map<string, (expeditionId: string) => void>();
  #closed = false;

  constructor(db: Database, options: ExpeditionServiceOptions = {}) {
    this.#db = db;
    this.#options = options;
  }

  async start(
    request: PartyExpeditionRequest,
    onExpired: (expeditionId: string) => void,
  ): Promise<PartyExpeditionStart> {
    const result = await startExpedition(this.#db, {
      startKey: `${this.#bootId}:${request.partyKey}`,
      leaderAccountId: request.leaderAccountId,
      shipId: request.shipId,
      members: request.members,
      ...(this.#options.prepareSeconds !== undefined
        ? { prepareSeconds: this.#options.prepareSeconds }
        : {}),
    });
    if (!result.ok) {
      if (REFUSAL[result.reason] === PartyErrorCode.PreparationUnavailable) {
        console.error(`[expedition] início recusado: ${result.reason}`);
      }
      return { ok: false, code: REFUSAL[result.reason] };
    }
    const deadline = result.prepareDeadlineAt.getTime();
    if (result.state === 'PREPARING') {
      this.#onExpired.set(result.expeditionId, onExpired);
      this.#schedule(result.expeditionId, deadline);
    }
    return { ok: true, expeditionId: result.expeditionId, prepareDeadline: deadline };
  }

  async cancel(expeditionId: string): Promise<void> {
    this.#onExpired.delete(expeditionId);
    const timer = this.#timers.get(expeditionId);
    if (timer) clearTimeout(timer);
    this.#timers.delete(expeditionId);
    // On failure the cancellation is retried by the same path as an expired deadline,
    // so the items never stay reserved for a preparation nobody is waiting for.
    await this.#expire(expeditionId);
  }

  /**
   * After a restart no PREPARING expedition has a room: each one is cancelled at its
   * deadline (at once if it already passed). Returns how many were found.
   */
  async recoverPreparations(): Promise<number> {
    const pending = await listPreparingExpeditions(this.#db);
    for (const { expeditionId, prepareDeadlineAt } of pending) {
      this.#schedule(expeditionId, prepareDeadlineAt.getTime());
    }
    return pending.length;
  }

  /** Stops the timers (server shutdown, tests); pending preparations stay for recovery. */
  close(): void {
    this.#closed = true;
    for (const timer of this.#timers.values()) clearTimeout(timer);
    this.#timers.clear();
    this.#onExpired.clear();
  }

  #schedule(expeditionId: string, deadline: number): void {
    if (this.#closed) return;
    const existing = this.#timers.get(expeditionId);
    if (existing) clearTimeout(existing);
    const delay = Math.max(0, deadline - (this.#options.now ?? Date.now)());
    const timer = setTimeout(() => void this.#expire(expeditionId), delay);
    timer.unref();
    this.#timers.set(expeditionId, timer);
  }

  async #expire(expeditionId: string): Promise<void> {
    this.#timers.delete(expeditionId);
    try {
      const result = await cancelPreparation(this.#db, expeditionId);
      const listener = this.#onExpired.get(expeditionId);
      this.#onExpired.delete(expeditionId);
      if (result === 'cancelled') listener?.(expeditionId);
    } catch (error) {
      const name = error instanceof Error ? error.name : typeof error;
      console.error(`[expedition] não foi possível cancelar a preparação vencida: ${name}`);
      this.#schedule(expeditionId, (this.#options.now ?? Date.now)() + CANCEL_RETRY_MS);
    }
  }
}
