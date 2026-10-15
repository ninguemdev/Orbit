import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Client, type Room } from '@colyseus/sdk';
import {
  AccountRoute,
  PARTY_KICKED_CLOSE_CODE,
  PARTY_ROOM_NAME,
  PartyClientMessage,
  type PartyInviteNotice,
  type PartyRefusal,
  PartyRoute,
  PartyServerMessage,
  type PartyStateView,
  type PartyTicketResponse,
} from '@orbit/contracts';
import { DEFAULT_IDENTITY_POLICY } from '../src/modules/identity/identity-service';
import { ALLOWED_ORIGIN, type ApiServer, call, startApiServer } from './api-harness';

type PartyRoomClient = Room<unknown, PartyStateView>;

interface Account {
  readonly nick: string;
  readonly token: string;
  readonly id: string;
}

async function waitFor(predicate: () => boolean, label: string, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`Tempo esgotado aguardando ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

const members = (room: PartyRoomClient) => {
  const ids: string[] = [];
  room.state.members?.forEach((_member, id) => ids.push(id));
  return ids.sort();
};

describe('parties', () => {
  let api: ApiServer;
  let rooms: PartyRoomClient[] = [];
  let counter = 0;

  beforeAll(async () => {
    api = await startApiServer({
      ...DEFAULT_IDENTITY_POLICY,
      loginAttemptsPerAddress: 1000,
      signUpsPerAddress: 1000,
    });
  });

  afterEach(async () => {
    await Promise.all(
      rooms.map((room) => Promise.race([room.leave().catch(() => undefined), sleep(500)])),
    );
    rooms = [];
  });

  afterAll(async () => {
    await api?.close();
  });

  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  async function account(): Promise<Account> {
    const nick = `Party_${++counter}_${Date.now().toString(36).slice(-4)}`;
    const response = await call(api.baseUrl, AccountRoute.Accounts, {
      method: 'POST',
      origin: ALLOWED_ORIGIN,
      body: { nick, password: 'senha de party longa' },
    });
    const body = response.body as { account: { id: string } };
    return { nick, token: response.token ?? '', id: body.account.id };
  }

  const ticket = (who: Account, body: unknown) =>
    call(api.baseUrl, PartyRoute.Tickets, {
      method: 'POST',
      origin: ALLOWED_ORIGIN,
      token: who.token,
      body,
    });

  function sdk(ticketValue?: string): Client {
    const client = new Client(api.baseUrl);
    if (ticketValue) client.auth.token = ticketValue;
    return client;
  }

  async function createParty(who: Account): Promise<PartyRoomClient> {
    const issued = (await ticket(who, { intent: 'create' })).body as PartyTicketResponse;
    const room = await sdk(issued.ticket).create<PartyStateView>(PARTY_ROOM_NAME);
    rooms.push(room);
    await waitFor(() => room.state.members?.size === 1, 'party criada');
    return room;
  }

  async function joinByCode(who: Account, code: string): Promise<PartyRoomClient> {
    const response = await ticket(who, { intent: 'join', inviteCode: code });
    expect(response.status).toBe(201);
    const issued = response.body as PartyTicketResponse;
    const room = await sdk(issued.ticket).joinById<PartyStateView>(issued.roomId ?? '');
    rooms.push(room);
    return room;
  }

  function refusals(room: PartyRoomClient): PartyRefusal[] {
    const list: PartyRefusal[] = [];
    room.onMessage(PartyServerMessage.Refused, (refusal: PartyRefusal) => list.push(refusal));
    return list;
  }

  it('creates a private party led by its creator, with an invite code', async () => {
    const leader = await account();
    const party = await createParty(leader);
    expect(party.state.leaderId).toBe(leader.id);
    expect(party.state.inviteCode).toMatch(/^[0-9A-HJKMNP-TV-Z]{6}$/);
  });

  it('lets a player in with the code, typed in any case', async () => {
    const [leader, guest] = [await account(), await account()];
    const party = await createParty(leader);
    const joined = await joinByCode(guest, party.state.inviteCode.toLowerCase());
    await waitFor(
      () => party.state.members.size === 2 && joined.state.members?.size === 2,
      'dois membros',
    );
    expect(members(joined)).toEqual([leader.id, guest.id].sort());
    expect(joined.state.leaderId).toBe(leader.id);
  });

  it('refuses outsiders: no ticket, reused ticket, wrong code, unauthenticated request', async () => {
    const [leader, outsider] = [await account(), await account()];
    const party = await createParty(leader);
    await expect(sdk().joinById(party.roomId)).rejects.toThrow(/invalid_ticket/);

    const createTicket = (
      (await ticket(outsider, { intent: 'create' })).body as PartyTicketResponse
    ).ticket;
    await expect(sdk(createTicket).joinById(party.roomId)).rejects.toThrow(/invalid_ticket/);

    const joinTicket = (
      await ticket(outsider, { intent: 'join', inviteCode: party.state.inviteCode })
    ).body as PartyTicketResponse;
    rooms.push(await sdk(joinTicket.ticket).joinById<PartyStateView>(party.roomId));
    await expect(sdk(joinTicket.ticket).joinById(party.roomId)).rejects.toThrow(/invalid_ticket/);

    expect(await ticket(outsider, { intent: 'join', inviteCode: 'ZZZZZZ' })).toMatchObject({
      status: 404,
      body: { error: 'invalid_invite_code' },
    });
    expect(
      (
        await call(api.baseUrl, PartyRoute.Tickets, {
          method: 'POST',
          origin: ALLOWED_ORIGIN,
          body: { intent: 'create' },
        })
      ).status,
    ).toBe(401);
  });

  it('refuses the same account twice without removing the connected member', async () => {
    const [leader, guest] = [await account(), await account()];
    const party = await createParty(leader);
    await joinByCode(guest, party.state.inviteCode);
    await waitFor(() => party.state.members.size === 2, 'dois membros');
    const again = (await ticket(guest, { intent: 'join', inviteCode: party.state.inviteCode }))
      .body as PartyTicketResponse;
    await expect(sdk(again.ticket).joinById(party.roomId)).rejects.toThrow(/already_member/);
    await sleep(200);
    expect(members(party)).toEqual([leader.id, guest.id].sort());
  });

  it('refuses a fifth member', async () => {
    const accounts = await Promise.all(Array.from({ length: 5 }, account));
    const [leader, ...others] = accounts;
    if (!leader) throw new Error('líder ausente');
    const party = await createParty(leader);
    for (const guest of others.slice(0, 3)) await joinByCode(guest, party.state.inviteCode);
    await waitFor(() => party.state.members.size === 4, 'party cheia');
    const fifth = others[3];
    if (!fifth) throw new Error('quinto ausente');
    expect(
      await ticket(fifth, { intent: 'join', inviteCode: party.state.inviteCode }),
    ).toMatchObject({
      status: 409,
      body: { error: 'party_full' },
    });
  });

  it('passes leadership to the longest-standing member when the leader leaves', async () => {
    const [leader, second, third] = [await account(), await account(), await account()];
    const party = await createParty(leader);
    const secondRoom = await joinByCode(second, party.state.inviteCode);
    await sleep(20);
    await joinByCode(third, party.state.inviteCode);
    await waitFor(() => secondRoom.state.members?.size === 3, 'três membros');
    await party.leave();
    rooms = rooms.filter((room) => room !== party);
    await waitFor(() => secondRoom.state.leaderId === second.id, 'nova liderança');
    expect(members(secondRoom)).toEqual([second.id, third.id].sort());
  });

  it('lets only the leader kick and promote', async () => {
    const [leader, member] = [await account(), await account()];
    const party = await createParty(leader);
    const memberRoom = await joinByCode(member, party.state.inviteCode);
    await waitFor(() => party.state.members.size === 2, 'dois membros');
    const refusedMember = refusals(memberRoom);

    memberRoom.send(PartyClientMessage.Kick, { accountId: leader.id });
    memberRoom.send(PartyClientMessage.Promote, { accountId: member.id });
    await waitFor(() => refusedMember.length === 2, 'recusas');
    expect(refusedMember.map((refusal) => refusal.code)).toEqual(['not_leader', 'not_leader']);

    party.send(PartyClientMessage.Promote, { accountId: member.id });
    await waitFor(() => party.state.leaderId === member.id, 'promoção');

    const kicked = new Promise<number>((resolve) => party.onLeave((code) => resolve(code)));
    memberRoom.send(PartyClientMessage.Kick, { accountId: leader.id });
    expect(await kicked).toBe(PARTY_KICKED_CLOSE_CODE);
    await waitFor(() => memberRoom.state.members.size === 1, 'expulsão');
    rooms = rooms.filter((room) => room !== party);
  });

  it('invites an online player by nick, who moves from their own party', async () => {
    const [leader, friend, stranger] = [await account(), await account(), await account()];
    const party = await createParty(leader);
    const friendSolo = await createParty(friend);
    const received: PartyInviteNotice[] = [];
    friendSolo.onMessage(PartyServerMessage.InviteReceived, (notice: PartyInviteNotice) =>
      received.push(notice),
    );
    const refused = refusals(party);

    party.send(PartyClientMessage.Invite, { nick: 'Ninguem_Online' });
    await waitFor(() => refused.length === 1, 'recusa offline');
    expect(refused[0]?.code).toBe('player_offline');

    party.send(PartyClientMessage.Invite, { nick: friend.nick.toUpperCase() });
    await waitFor(() => received.length === 1, 'convite recebido');
    const notice = received[0];
    if (!notice) throw new Error('convite ausente');
    expect(notice).toMatchObject({ fromNick: leader.nick, memberCount: 1 });

    // An invite only works for the account it was addressed to.
    expect(await ticket(stranger, { intent: 'accept', inviteId: notice.inviteId })).toMatchObject({
      status: 404,
      body: { error: 'invite_not_found' },
    });

    const accepted = (await ticket(friend, { intent: 'accept', inviteId: notice.inviteId }))
      .body as PartyTicketResponse;
    const soloLeft = new Promise<void>((resolve) => friendSolo.onLeave(() => resolve()));
    const joined = await sdk(accepted.ticket).joinById<PartyStateView>(accepted.roomId ?? '');
    rooms.push(joined);
    await soloLeft; // the previous party drops the member who moved
    await waitFor(() => party.state.members.size === 2, 'convidado na party');
    expect(await ticket(friend, { intent: 'accept', inviteId: notice.inviteId })).toMatchObject({
      status: 404,
    });
  });
});
