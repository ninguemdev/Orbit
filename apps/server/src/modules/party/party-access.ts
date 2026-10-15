import {
  AccountErrorCode,
  PARTY_MAX_MEMBERS,
  type PartyTicketResponse,
  partyTicketRequestSchema,
} from '@orbit/contracts';
import { SlidingWindowLimiter } from '../../infrastructure/sliding-window-limiter';
import type { PartyDirectory } from './party-directory';
import type { RoomTicketStore, TicketHolder } from './room-tickets';

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

  constructor(deps: { tickets: RoomTicketStore; directory: PartyDirectory; now?: () => number }) {
    this.#tickets = deps.tickets;
    this.#directory = deps.directory;
    this.#codeGuesses = new SlidingWindowLimiter({
      limit: 20,
      windowMs: 15 * 60 * 1000,
      ...(deps.now ? { now: deps.now } : {}),
    });
  }

  issue(input: unknown, holder: TicketHolder, address: string): PartyAccessResult {
    const parsed = partyTicketRequestSchema.safeParse(input);
    if (!parsed.success) return { ok: false, code: AccountErrorCode.InvalidInput };
    const request = parsed.data;

    if (request.intent === 'create') {
      return {
        ok: true,
        response: { ticket: this.#tickets.issue({ ...holder, intent: { kind: 'create' } }) },
      };
    }

    let roomId: string;
    if (request.intent === 'join') {
      if (!this.#codeGuesses.tryConsume(address)) {
        return { ok: false, code: AccountErrorCode.RateLimited };
      }
      const room = this.#directory.findByInviteCode(request.inviteCode);
      if (!room) return { ok: false, code: AccountErrorCode.InvalidInviteCode };
      roomId = room.roomId;
    } else {
      const invite = this.#directory.takeInvite(request.inviteId, holder.accountId);
      if (!invite) return { ok: false, code: AccountErrorCode.InviteNotFound };
      roomId = invite.roomId;
    }

    const room = this.#directory.room(roomId);
    if (!room) return { ok: false, code: AccountErrorCode.InvalidInviteCode };
    if (room.memberCount() >= PARTY_MAX_MEMBERS && !room.hasMember(holder.accountId)) {
      return { ok: false, code: AccountErrorCode.PartyFull };
    }
    const ticket = this.#tickets.issue({ ...holder, intent: { kind: 'join', roomId } });
    return { ok: true, response: { ticket, roomId } };
  }
}
