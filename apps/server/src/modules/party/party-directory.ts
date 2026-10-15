import { randomUUID } from 'node:crypto';
import { PARTY_INVITE_TTL_SECONDS, type PartyInviteNotice, normalizeNick } from '@orbit/contracts';
import { normalizeCrockford, randomCrockford } from '../../infrastructure/crockford';

/** What the directory needs from a live party room. */
export interface PartyRoomHandle {
  readonly roomId: string;
  readonly inviteCode: string;
  memberCount(): number;
  hasMember(accountId: string): boolean;
  /** Accounts the leader removed may only come back through a new invite. */
  refusesAccount(accountId: string): boolean;
  /** Shows an invite to a member of this room; false if they are not connected here. */
  notifyInvite(accountId: string, notice: PartyInviteNotice): boolean;
  /** Removes a member who has just joined another party. */
  evict(accountId: string): void;
}

export interface PartyInvite {
  readonly id: string;
  readonly roomId: string;
  readonly toAccountId: string;
  readonly fromNick: string;
  readonly expiresAt: number;
}

const CODE_LENGTH = 6;

/**
 * In-memory index of live parties for one game process: invite codes, which party
 * each online account is in, and pending invites. Parties are lobby state; they do
 * not survive a restart.
 */
export class PartyDirectory {
  readonly #rooms = new Map<string, PartyRoomHandle>();
  readonly #roomByCode = new Map<string, string>();
  readonly #membership = new Map<string, { roomId: string; nick: string }>();
  readonly #accountByNick = new Map<string, string>();
  readonly #invites = new Map<string, PartyInvite>();
  readonly #now: () => number;

  constructor(now: () => number = Date.now) {
    this.#now = now;
  }

  newInviteCode(): string {
    for (;;) {
      const code = randomCrockford(CODE_LENGTH);
      if (!this.#roomByCode.has(code)) return code;
    }
  }

  register(room: PartyRoomHandle): void {
    this.#rooms.set(room.roomId, room);
    this.#roomByCode.set(room.inviteCode, room.roomId);
  }

  unregister(room: PartyRoomHandle): void {
    this.#rooms.delete(room.roomId);
    this.#roomByCode.delete(room.inviteCode);
    for (const [id, invite] of this.#invites) {
      if (invite.roomId === room.roomId) this.#invites.delete(id);
    }
  }

  room(roomId: string): PartyRoomHandle | null {
    return this.#rooms.get(roomId) ?? null;
  }

  findByInviteCode(code: string): PartyRoomHandle | null {
    const roomId = this.#roomByCode.get(normalizeCrockford(code));
    return roomId ? this.room(roomId) : null;
  }

  /** Records membership; an account in another party is removed from it first. */
  joined(accountId: string, nick: string, roomId: string): void {
    const previous = this.#membership.get(accountId);
    if (previous && previous.roomId !== roomId) this.#rooms.get(previous.roomId)?.evict(accountId);
    this.#membership.set(accountId, { roomId, nick });
    this.#accountByNick.set(normalizeNick(nick), accountId);
  }

  left(accountId: string, roomId: string): void {
    const current = this.#membership.get(accountId);
    if (current?.roomId !== roomId) return; // Already moved to another party.
    this.#membership.delete(accountId);
    this.#accountByNick.delete(normalizeNick(current.nick));
  }

  /** Online = currently in a party (every signed-in client keeps one). */
  findOnline(nick: string): { accountId: string; roomId: string } | null {
    const accountId = this.#accountByNick.get(normalizeNick(nick));
    const membership = accountId ? this.#membership.get(accountId) : undefined;
    return accountId && membership ? { accountId, roomId: membership.roomId } : null;
  }

  createInvite(roomId: string, toAccountId: string, fromNick: string): PartyInvite {
    this.#purgeExpired();
    for (const [id, invite] of this.#invites) {
      if (invite.roomId === roomId && invite.toAccountId === toAccountId) this.#invites.delete(id);
    }
    const invite: PartyInvite = {
      id: randomUUID(),
      roomId,
      toAccountId,
      fromNick,
      expiresAt: this.#now() + PARTY_INVITE_TTL_SECONDS * 1000,
    };
    this.#invites.set(invite.id, invite);
    return invite;
  }

  /** A live invite addressed to `accountId`, without consuming it. */
  findInvite(inviteId: string, accountId: string): PartyInvite | null {
    const invite = this.#invites.get(inviteId);
    if (!invite || invite.toAccountId !== accountId) return null;
    return invite.expiresAt > this.#now() && this.#rooms.has(invite.roomId) ? invite : null;
  }

  /** Consumes an invite once the caller has been admitted. */
  consumeInvite(inviteId: string): void {
    this.#invites.delete(inviteId);
  }

  #purgeExpired(): void {
    const now = this.#now();
    for (const [id, invite] of this.#invites) if (invite.expiresAt <= now) this.#invites.delete(id);
  }
}
