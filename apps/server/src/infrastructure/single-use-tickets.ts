import { randomBytes } from 'node:crypto';

const TICKET_TTL_MS = 30_000;

/**
 * Single-use, short-lived tickets that let an authenticated HTTP session enter a
 * room. Kept in process memory (one game process); never logged or persisted.
 */
export class SingleUseTickets<T> {
  readonly #tickets = new Map<string, { readonly ticket: T; readonly expiresAt: number }>();
  readonly #now: () => number;

  constructor(now: () => number = Date.now) {
    this.#now = now;
  }

  issue(ticket: T): string {
    this.#purgeExpired();
    const token = randomBytes(32).toString('base64url');
    this.#tickets.set(token, { ticket, expiresAt: this.#now() + TICKET_TTL_MS });
    return token;
  }

  /** Returns the ticket and invalidates it; null when unknown, used or expired. */
  consume(token: string | undefined): T | null {
    if (!token) return null;
    const entry = this.#tickets.get(token);
    if (!entry) return null;
    this.#tickets.delete(token);
    return entry.expiresAt > this.#now() ? entry.ticket : null;
  }

  #purgeExpired(): void {
    const now = this.#now();
    for (const [token, entry] of this.#tickets) {
      if (entry.expiresAt <= now) this.#tickets.delete(token);
    }
  }
}
