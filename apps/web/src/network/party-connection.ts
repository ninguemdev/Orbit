import { Client, type Room } from '@colyseus/sdk';
import {
  PARTY_ROOM_NAME,
  PartyClientMessage,
  type PartyInviteNotice,
  type PartyRefusal,
  PartyRoute,
  PartyServerMessage,
  type PartyStateView,
  type PartyTicketRequest,
  type PartyTicketResponse,
} from '@orbit/contracts';
import { type ClientErrorCode, requestJson } from './account-client';
import { defaultServerEndpoint } from './sector-connection';

export interface PartyMember {
  readonly accountId: string;
  readonly nick: string;
  readonly connected: boolean;
  readonly classId: string;
}

export interface PartyView {
  readonly leaderId: string;
  readonly inviteCode: string;
  /** Ordered by arrival. */
  readonly members: readonly PartyMember[];
}

export interface PartyListeners {
  onChange(view: PartyView): void;
  onInvite(notice: PartyInviteNotice): void;
  onRefused(refusal: PartyRefusal): void;
  /** The server closed the party connection (kicked, moved, lost). */
  onClosed(code: number): void;
}

export type OpenPartyResult =
  | { readonly ok: true; readonly party: PartyConnection }
  | { readonly ok: false; readonly code: ClientErrorCode | 'join_failed' };

/** One party membership: a ticket from the account API, then the party room. */
export class PartyConnection {
  readonly #room: Room<unknown, PartyStateView>;
  #closedByUs = false;
  #closed = false;

  private constructor(room: Room<unknown, PartyStateView>, listeners: PartyListeners) {
    this.#room = room;
    room.onStateChange((state) => listeners.onChange(toView(state)));
    room.onMessage(PartyServerMessage.InviteReceived, (notice: PartyInviteNotice) =>
      listeners.onInvite(notice),
    );
    room.onMessage(PartyServerMessage.Refused, (refusal: PartyRefusal) =>
      listeners.onRefused(refusal),
    );
    room.onLeave((code) => {
      this.#closed = true;
      if (!this.#closedByUs) listeners.onClosed(code);
    });
  }

  static async open(
    request: PartyTicketRequest,
    listeners: PartyListeners,
  ): Promise<OpenPartyResult> {
    const issued = await requestJson<PartyTicketResponse>(PartyRoute.Tickets, 'POST', request);
    if (!issued.ok) return issued;
    const client = new Client(defaultServerEndpoint());
    client.auth.token = issued.data.ticket;
    try {
      const room = issued.data.roomId
        ? await client.joinById<PartyStateView>(issued.data.roomId)
        : await client.create<PartyStateView>(PARTY_ROOM_NAME);
      return { ok: true, party: new PartyConnection(room, listeners) };
    } catch {
      return { ok: false, code: 'join_failed' };
    }
  }

  /** The room connection has ended (for any reason). */
  get closed(): boolean {
    return this.#closed;
  }

  get roomId(): string {
    return this.#room.roomId;
  }

  invite(nick: string): void {
    this.#room.send(PartyClientMessage.Invite, { nick });
  }

  kick(accountId: string): void {
    this.#room.send(PartyClientMessage.Kick, { accountId });
  }

  promote(accountId: string): void {
    this.#room.send(PartyClientMessage.Promote, { accountId });
  }

  selectClass(classId: string): void {
    this.#room.send(PartyClientMessage.SelectClass, { classId });
  }

  /** Leaves on purpose; listeners are not told about this close. */
  async leave(): Promise<void> {
    this.#closedByUs = true;
    await this.#room.leave(true).catch(() => undefined);
  }
}

function toView(state: PartyStateView): PartyView {
  const members: { member: PartyMember; joinedAt: number }[] = [];
  state.members?.forEach((member, accountId) => {
    members.push({
      member: {
        accountId,
        nick: member.nick,
        connected: member.connected,
        classId: member.classId,
      },
      joinedAt: member.joinedAt,
    });
  });
  members.sort((a, b) => a.joinedAt - b.joinedAt);
  return {
    leaderId: state.leaderId ?? '',
    inviteCode: state.inviteCode ?? '',
    members: members.map((entry) => entry.member),
  };
}
