import {
  AccountErrorCode,
  PARTY_MAX_MEMBERS,
  type PartyTicketResponse,
  partyTicketRequestSchema,
} from '@orbit/contracts';
import { SlidingWindowLimiter } from '../../infrastructure/sliding-window-limiter';
import type { PartyDirectory } from './party-directory';
import type { RoomTicketStore, TicketHolder } from './room-tickets';

const DEFAULT_CODE_GUESSES_PER_ADDRESS = 20;

export type PartyAccessResult =
  | { readonly ok: true; readonly response: PartyTicketResponse }
  | { readonly ok: false; readonly code: AccountErrorCode };

/**
 * Decides who may enter which party and issues the matching room ticket: a new
 * party, a party by invite code, or the party of an invite addressed to the caller.
 */
export class PartyAccess {
  readonly #tickets: RoomTicketStore;
  readonly #directory: PartyDirectory;
  /** Invite codes are short; guesses are limited per client address. */
  readonly #codeGuesses: SlidingWindowLimiter;
  /** Every ticket creates state (and often a room); bounded per account. */
  readonly #ticketsByAccount: SlidingWindowLimiter;

  constructor(deps: {
    tickets: RoomTicketStore;
    directory: PartyDirectory;
    now?: () => number;
    /** Invite code attempts per address in 15 minutes (default 20). */
    codeGuessesPerAddress?: number;
  }) {
    this.#tickets = deps.tickets;
    this.#directory = deps.directory;
    const clock = deps.now ? { now: deps.now } : {};
    this.#codeGuesses = new SlidingWindowLimiter({
      limit: deps.codeGuessesPerAddress ?? DEFAULT_CODE_GUESSES_PER_ADDRESS,
      windowMs: 15 * 60 * 1000,
      ...clock,
    });
    this.#ticketsByAccount = new SlidingWindowLimiter({ limit: 30, windowMs: 60 * 1000, ...clock });
  }

  issue(input: unknown, holder: TicketHolder, address: string): PartyAccessResult {
    const parsed = partyTicketRequestSchema.safeParse(input);
    if (!parsed.success) return { ok: false, code: AccountErrorCode.InvalidInput };
    const request = parsed.data;
    if (!this.#ticketsByAccount.tryConsume(holder.accountId)) {
      return { ok: false, code: AccountErrorCode.RateLimited };
    }

    if (request.intent === 'create') {
      return {
        ok: true,
        response: { ticket: this.#tickets.issue({ ...holder, intent: { kind: 'create' } }) },
      };
    }

    let roomId: string;
    let inviteId: string | null = null;
    if (request.intent === 'join') {
      if (!this.#codeGuesses.tryConsume(address)) {
        return { ok: false, code: AccountErrorCode.RateLimited };
      }
      const room = this.#directory.findByInviteCode(request.inviteCode);
      if (!room) return { ok: false, code: AccountErrorCode.InvalidInviteCode };
      roomId = room.roomId;
    } else {
      const invite = this.#directory.findInvite(request.inviteId, holder.accountId);
      if (!invite) return { ok: false, code: AccountErrorCode.InviteNotFound };
      roomId = invite.roomId;
      inviteId = invite.id;
    }

    const room = this.#directory.room(roomId);
    if (!room) return { ok: false, code: AccountErrorCode.InvalidInviteCode };
    if (inviteId === null && room.refusesAccount(holder.accountId)) {
      return { ok: false, code: AccountErrorCode.RemovedFromParty };
    }
    if (room.memberCount() >= PARTY_MAX_MEMBERS && !room.hasMember(holder.accountId)) {
      // A refused accept keeps the invite, so it can be used once a seat frees up.
      return { ok: false, code: AccountErrorCode.PartyFull };
    }
    if (inviteId !== null) this.#directory.consumeInvite(inviteId);
    const ticket = this.#tickets.issue({
      ...holder,
      intent: { kind: 'join', roomId, invited: inviteId !== null },
    });
    return { ok: true, response: { ticket, roomId } };
  }
}
