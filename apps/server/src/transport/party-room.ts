import { type AuthContext, type Client, Room, ServerError } from '@colyseus/core';
import {
  PARTY_INVITE_TTL_SECONDS,
  PARTY_KICKED_CLOSE_CODE,
  PARTY_MAX_MEMBERS,
  PARTY_MOVED_CLOSE_CODE,
  PARTY_RECONNECTION_SECONDS,
  PartyClientMessage,
  PartyErrorCode,
  type PartyInviteNotice,
  type PartyRefusal,
  PartyServerMessage,
  partyInviteSchema,
  partyMemberTargetSchema,
} from '@orbit/contracts';
import type { PartyDirectory, PartyRoomHandle } from '../modules/party/party-directory';
import type { RoomTicket, RoomTicketStore } from '../modules/party/room-tickets';
import { PartyMemberState, PartyState } from './party-schema';

export interface PartyRoomDeps {
  readonly tickets: RoomTicketStore;
  readonly directory: PartyDirectory;
  readonly now?: () => number;
}

type PartyClient = Client<{ auth: RoomTicket }>;

/**
 * A party: up to four accounts preparing together. Entry requires a single-use
 * ticket issued to an authenticated session; the leader manages members.
 */
export class PartyRoom
  extends Room<{ state: PartyState; client: PartyClient }>
  implements PartyRoomHandle
{
  override maxClients = PARTY_MAX_MEMBERS;
  override maxMessagesPerSecond = 20;
  override state = new PartyState();

  /** Replaced by `definePartyRoom`. */
  protected deps: PartyRoomDeps | undefined;
  inviteCode = '';
  readonly #clients = new Map<string, PartyClient>();
  /** Members removed on purpose (kicked or moved): their drop gets no reconnection. */
  readonly #removed = new Set<string>();
  /** Removed by the leader: the invite code no longer admits them, a new invite does. */
  readonly #kicked = new Set<string>();

  /** Refuses everyone unless registered through `definePartyRoom`. */
  static override async onAuth(
    _token: string,
    _options: unknown,
    _context: AuthContext,
  ): Promise<RoomTicket> {
    throw new ServerError(403, 'invalid_ticket');
  }

  get #deps(): PartyRoomDeps {
    if (!this.deps) throw new Error('PartyRoom sem dependências');
    return this.deps;
  }

  override onCreate(): void {
    this.inviteCode = this.#deps.directory.newInviteCode();
    this.state.inviteCode = this.inviteCode;
    this.#deps.directory.register(this);
    void this.setPrivate(true);

    this.onMessage(PartyClientMessage.Invite, (client: PartyClient, raw: unknown) => {
      const parsed = partyInviteSchema.safeParse(raw);
      if (!parsed.success)
        return this.#refuse(client, PartyClientMessage.Invite, PartyErrorCode.InvalidPayload);
      this.#invite(client, parsed.data.nick);
    });
    this.onMessage(PartyClientMessage.Kick, (client: PartyClient, raw: unknown) => {
      const parsed = partyMemberTargetSchema.safeParse(raw);
      if (!parsed.success)
        return this.#refuse(client, PartyClientMessage.Kick, PartyErrorCode.InvalidPayload);
      this.#kick(client, parsed.data.accountId);
    });
    this.onMessage(PartyClientMessage.Promote, (client: PartyClient, raw: unknown) => {
      const parsed = partyMemberTargetSchema.safeParse(raw);
      if (!parsed.success)
        return this.#refuse(client, PartyClientMessage.Promote, PartyErrorCode.InvalidPayload);
      this.#promote(client, parsed.data.accountId);
    });
    this.onMessage('*', (client: PartyClient, type) => {
      this.#refuse(client, String(type), PartyErrorCode.InvalidPayload);
    });
  }

  override onJoin(client: PartyClient): void {
    const ticket = client.auth;
    if (!ticket) throw new ServerError(403, 'invalid_ticket');
    const { intent, accountId, nick } = ticket;
    if (intent.kind === 'join' && intent.roomId !== this.roomId) {
      throw new ServerError(403, 'invalid_ticket');
    }
    if (intent.kind === 'create' && this.state.members.size > 0) {
      throw new ServerError(403, 'invalid_ticket');
    }
    if (this.state.members.has(accountId)) throw new ServerError(409, PartyErrorCode.AlreadyMember);
    if (this.#kicked.has(accountId) && intent.kind === 'join' && !intent.invited) {
      throw new ServerError(403, 'removed_from_party');
    }
    this.#kicked.delete(accountId);

    const member = new PartyMemberState();
    member.accountId = accountId;
    member.nick = nick;
    member.connected = true;
    member.joinedAt = this.#now();
    this.state.members.set(accountId, member);
    if (!this.state.leaderId) this.state.leaderId = accountId;
    this.#clients.set(accountId, client);
    this.#removed.delete(accountId);
    this.#deps.directory.joined(accountId, nick, this.roomId);
  }

  override onDrop(client: PartyClient): void {
    const accountId = client.auth?.accountId;
    // Also called for a connection whose join was refused; it never became a member.
    if (!accountId || this.#clients.get(accountId) !== client) return;
    const member = this.state.members.get(accountId);
    if (member) member.connected = false;
    if (!this.#removed.has(accountId)) {
      // Rejects when the client dropped before finishing the join handshake or when the
      // seat expires; Colyseus then calls onLeave. Unhandled, it would end the process.
      this.allowReconnection(client, PARTY_RECONNECTION_SECONDS).catch(() => undefined);
    }
  }

  override onReconnect(client: PartyClient): void {
    const accountId = client.auth?.accountId;
    const member = accountId ? this.state.members.get(accountId) : undefined;
    if (!accountId || !member) {
      // Removed while disconnected (kicked, or joined another party): the seat was
      // still reserved, but the member is gone.
      const kicked = accountId !== undefined && this.#kicked.has(accountId);
      client.leave(kicked ? PARTY_KICKED_CLOSE_CODE : PARTY_MOVED_CLOSE_CODE);
      return;
    }
    member.connected = true;
    this.#clients.set(accountId, client);
  }

  override onLeave(client: PartyClient): void {
    const accountId = client.auth?.accountId;
    // A refused join (e.g. the same account in a second tab) must not remove the
    // member connected through another client.
    if (!accountId || this.#clients.get(accountId) !== client) return;
    this.#clients.delete(accountId);
    this.#removeMember(accountId);
  }

  override onDispose(): void {
    this.#deps.directory.unregister(this);
  }

  // PartyRoomHandle ------------------------------------------------------------

  memberCount(): number {
    return this.state.members.size;
  }

  hasMember(accountId: string): boolean {
    return this.state.members.has(accountId);
  }

  refusesAccount(accountId: string): boolean {
    return this.#kicked.has(accountId);
  }

  notifyInvite(accountId: string, notice: PartyInviteNotice): boolean {
    const client = this.#clients.get(accountId);
    // A member in the reconnection window cannot see it now.
    if (!client || !this.state.members.get(accountId)?.connected) return false;
    client.send(PartyServerMessage.InviteReceived, notice);
    return true;
  }

  evict(accountId: string): void {
    this.#removeOnPurpose(accountId, PARTY_MOVED_CLOSE_CODE, 'moved_to_another_party');
  }

  // Rules ------------------------------------------------------------------------

  #invite(client: PartyClient, nick: string): void {
    const action = PartyClientMessage.Invite;
    if (!this.#isLeader(client)) return this.#refuse(client, action, PartyErrorCode.NotLeader);
    if (this.state.members.size >= PARTY_MAX_MEMBERS) {
      return this.#refuse(client, action, PartyErrorCode.PartyFull);
    }
    const target = this.#deps.directory.findOnline(nick);
    if (!target) return this.#refuse(client, action, PartyErrorCode.PlayerOffline);
    if (this.state.members.has(target.accountId)) {
      return this.#refuse(client, action, PartyErrorCode.AlreadyMember);
    }
    // A new invite is the way back for a removed member.
    this.#kicked.delete(target.accountId);
    const invite = this.#deps.directory.createInvite(
      this.roomId,
      target.accountId,
      client.auth?.nick ?? '',
    );
    const delivered = this.#deps.directory.room(target.roomId)?.notifyInvite(target.accountId, {
      inviteId: invite.id,
      fromNick: client.auth?.nick ?? '',
      memberCount: this.state.members.size,
      expiresInSeconds: PARTY_INVITE_TTL_SECONDS,
    });
    if (!delivered) this.#refuse(client, action, PartyErrorCode.PlayerOffline);
  }

  #kick(client: PartyClient, targetId: string): void {
    const action = PartyClientMessage.Kick;
    if (!this.#isLeader(client)) return this.#refuse(client, action, PartyErrorCode.NotLeader);
    if (targetId === client.auth?.accountId || !this.state.members.has(targetId)) {
      return this.#refuse(client, action, PartyErrorCode.NotMember);
    }
    this.#kicked.add(targetId);
    this.#removeOnPurpose(targetId, PARTY_KICKED_CLOSE_CODE, 'kicked_by_leader');
  }

  /**
   * Removes a member now. A connected one is disconnected with `code`; a dropped one
   * is taken off the list at once (closing their dead socket would do nothing), and a
   * later reconnection is turned away in onReconnect.
   */
  #removeOnPurpose(accountId: string, code: number, reason: string): void {
    this.#removed.add(accountId);
    const member = this.state.members.get(accountId);
    const client = this.#clients.get(accountId);
    if (client && member?.connected) {
      client.leave(code, reason);
      return;
    }
    this.#removeMember(accountId);
  }

  #promote(client: PartyClient, targetId: string): void {
    const action = PartyClientMessage.Promote;
    if (!this.#isLeader(client)) return this.#refuse(client, action, PartyErrorCode.NotLeader);
    if (!this.state.members.has(targetId))
      return this.#refuse(client, action, PartyErrorCode.NotMember);
    this.state.leaderId = targetId;
  }

  #removeMember(accountId: string): void {
    if (!this.state.members.delete(accountId)) return;
    this.#deps.directory.left(accountId, this.roomId);
    if (this.state.leaderId === accountId) this.state.leaderId = this.#nextLeader();
  }

  /** The longest-standing member leads; connected members are preferred. */
  #nextLeader(): string {
    const members = [...this.state.members.values()].sort((a, b) => a.joinedAt - b.joinedAt);
    return (members.find((member) => member.connected) ?? members[0])?.accountId ?? '';
  }

  #isLeader(client: PartyClient): boolean {
    return client.auth?.accountId === this.state.leaderId;
  }

  #refuse(client: PartyClient, action: string, code: PartyErrorCode): void {
    const refusal: PartyRefusal = { action, code };
    client.send(PartyServerMessage.Refused, refusal);
  }

  #now(): number {
    return (this.#deps.now ?? Date.now)();
  }
}

/** Binds the party room to this server's ticket store and directory. */
export function definePartyRoom(deps: PartyRoomDeps): typeof PartyRoom {
  return class ConfiguredPartyRoom extends PartyRoom {
    protected override deps: PartyRoomDeps | undefined = deps;

    static override async onAuth(
      token: string,
      _options: unknown,
      _context: AuthContext,
    ): Promise<RoomTicket> {
      const ticket = deps.tickets.consume(token);
      if (!ticket) throw new ServerError(403, 'invalid_ticket');
      return ticket;
    }
  };
}
