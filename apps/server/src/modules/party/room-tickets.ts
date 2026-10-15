import { randomBytes } from 'node:crypto';

export type TicketIntent =
  | { readonly kind: 'create' }
  /** `invited`: admitted by an invite rather than the shared code. */
  | { readonly kind: 'join'; readonly roomId: string; readonly invited: boolean };

export interface TicketHolder {
  readonly accountId: string;
  readonly nick: string;
}

export interface RoomTicket extends TicketHolder {
  readonly intent: TicketIntent;
}

const TICKET_TTL_MS = 30_000;

/**
 * Single-use, short-lived tickets that let an authenticated HTTP session enter a
 * room. Kept in process memory (one game process); never logged or persisted.
 */
export class RoomTicketStore {
  readonly #tickets = new Map<string, RoomTicket & { readonly expiresAt: number }>();
  readonly #now: () => number;

  constructor(now: () => number = Date.now) {
    this.#now = now;
  }

  issue(ticket: RoomTicket): string {
    this.#purgeExpired();
    const token = randomBytes(32).toString('base64url');
    this.#tickets.set(token, { ...ticket, expiresAt: this.#now() + TICKET_TTL_MS });
    return token;
  }

  /** Returns the ticket and invalidates it; null when unknown, used or expired. */
  consume(token: string | undefined): RoomTicket | null {
    if (!token) return null;
    const ticket = this.#tickets.get(token);
    if (!ticket) return null;
    this.#tickets.delete(token);
    if (ticket.expiresAt <= this.#now()) return null;
    return { accountId: ticket.accountId, nick: ticket.nick, intent: ticket.intent };
  }

  #purgeExpired(): void {
    const now = this.#now();
    for (const [token, ticket] of this.#tickets) {
      if (ticket.expiresAt <= now) this.#tickets.delete(token);
    }
  }
}
