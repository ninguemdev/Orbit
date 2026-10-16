import { Client, type Room } from '@colyseus/sdk';
import {
  type ExpeditionEndedNotice,
  PARTY_ROOM_NAME,
  PartyClientMessage,
  type PartyInviteNotice,
  type PartyMemberView,
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
  /** Ship licenses this member brings to the party. */
  readonly ships: readonly string[];
  readonly ready: boolean;
}

export interface PartyView {
  readonly leaderId: string;
  readonly inviteCode: string;
  /** Ship chosen by the leader; empty when none is valid. */
  readonly selectedShipId: string;
  /** Requests for readiness and confirmation name this revision. */
  readonly revision: number;
  /** Revision the leader confirmed; 0 when there is no valid confirmation. */
  readonly confirmedRevision: number;
  /** Expedition reserved by the confirmation, while it waits for the match. */
  readonly expedition: {
    readonly id: string;
    /** Loading into the match, or the match is running. */
    readonly state: 'PREPARING' | 'ACTIVE';
    readonly secondsLeft: number;
    /** Accounts in the expedition; who joined the party later is not among them. */
    readonly memberIds: readonly string[];
  } | null;
  /** Ordered by arrival. */
  readonly members: readonly PartyMember[];
}

export interface PartyListeners {
  onChange(view: PartyView): void;
  onInvite(notice: PartyInviteNotice): void;
  onRefused(refusal: PartyRefusal): void;
  onExpeditionEnded(notice: ExpeditionEndedNotice): void;
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
    room.onMessage(PartyServerMessage.ExpeditionEnded, (notice: ExpeditionEndedNotice) =>
      listeners.onExpeditionEnded(notice),
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

  selectShip(shipId: string): void {
    this.#room.send(PartyClientMessage.SelectShip, { shipId });
  }

  setReady(revision: number, ready: boolean): void {
    this.#room.send(PartyClientMessage.SetReady, { revision, ready });
  }

  confirm(revision: number): void {
    this.#room.send(PartyClientMessage.Confirm, { revision });
  }

  /** Leaves on purpose; listeners are not told about this close. */
  async leave(): Promise<void> {
    this.#closedByUs = true;
    await this.#room.leave(true).catch(() => undefined);
  }
}

/** Copies a synchronized list of strings (ships, expedition members). */
function stringsOf(list: PartyMemberView['ships'] | undefined): string[] {
  const values: string[] = [];
  list?.forEach((value) => values.push(value));
  return values;
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
        ships: stringsOf(member.ships),
        ready: member.ready,
      },
      joinedAt: member.joinedAt,
    });
  });
  members.sort((a, b) => a.joinedAt - b.joinedAt);
  return {
    leaderId: state.leaderId ?? '',
    inviteCode: state.inviteCode ?? '',
    selectedShipId: state.selectedShipId ?? '',
    revision: state.revision ?? 0,
    confirmedRevision: state.confirmedRevision ?? 0,
    expedition:
      state.expeditionId &&
      (state.expeditionState === 'PREPARING' || state.expeditionState === 'ACTIVE')
        ? {
            id: state.expeditionId,
            state: state.expeditionState,
            secondsLeft: state.prepareSecondsLeft ?? 0,
            memberIds: stringsOf(state.expeditionMemberIds),
          }
        : null,
    members: members.map((entry) => entry.member),
  };
}
