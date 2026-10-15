import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Client, type Room } from '@colyseus/sdk';
import { ItemId } from '@orbit/catalog';
import {
  AccountRoute,
  type InventoryResponse,
  PARTY_ROOM_NAME,
  PartyClientMessage,
  type PartyMemberView,
  type PartyRefusal,
  PartyRoute,
  PartyServerMessage,
  type PartyStateView,
  type PartyTicketResponse,
} from '@orbit/contracts';
import { grantItem } from '@orbit/database';
import { DEFAULT_IDENTITY_POLICY } from '../src/modules/identity/identity-service';
import { ALLOWED_ORIGIN, type ApiServer, call, startApiServer } from './api-harness';

type PartyRoomClient = Room<unknown, PartyStateView>;

interface Player {
  readonly id: string;
  readonly token: string;
}

async function waitFor(predicate: () => boolean, label: string, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`Tempo esgotado aguardando ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

const memberOf = (room: PartyRoomClient, id: string) => {
  let found: PartyMemberView | undefined;
  room.state.members?.forEach((member, memberId) => {
    if (memberId === id) found = member;
  });
  return found;
};
const readyCount = (room: PartyRoomClient) => {
  let count = 0;
  room.state.members?.forEach((member) => (count += member.ready ? 1 : 0));
  return count;
};

describe('party readiness and confirmation', () => {
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
    await Promise.all(rooms.map((room) => room.leave().catch(() => undefined)));
    rooms = [];
  });

  afterAll(async () => {
    await api?.close();
  });

  async function player(): Promise<Player> {
    const response = await call(api.baseUrl, AccountRoute.Accounts, {
      method: 'POST',
      origin: ALLOWED_ORIGIN,
      body: { nick: `Pronto_${++counter}`, password: 'senha de prontidao longa' },
    });
    return {
      id: (response.body as { account: { id: string } }).account.id,
      token: response.token ?? '',
    };
  }

  async function enter(who: Player, body: unknown): Promise<PartyRoomClient> {
    const issued = (
      await call(api.baseUrl, PartyRoute.Tickets, {
        method: 'POST',
        origin: ALLOWED_ORIGIN,
        token: who.token,
        body,
      })
    ).body as PartyTicketResponse;
    const client = new Client(api.baseUrl);
    client.auth.token = issued.ticket;
    const room = issued.roomId
      ? await client.joinById<PartyStateView>(issued.roomId)
      : await client.create<PartyStateView>(PARTY_ROOM_NAME);
    rooms.push(room);
    await waitFor(() => memberOf(room, who.id) !== undefined, 'entrada na party');
    return room;
  }

  /** Leader and guest in one party, both with a class chosen. */
  async function pair() {
    const [leader, guest] = [await player(), await player()];
    const party = await enter(leader, { intent: 'create' });
    const guestRoom = await enter(guest, { intent: 'join', inviteCode: party.state.inviteCode });
    party.send(PartyClientMessage.SelectClass, { classId: 'class.pilot' });
    guestRoom.send(PartyClientMessage.SelectClass, { classId: 'class.engineer' });
    await waitFor(
      () =>
        memberOf(party, leader.id)?.classId === 'class.pilot' &&
        memberOf(party, guest.id)?.classId === 'class.engineer',
      'classes salvas',
    );
    return { leader, guest, party, guestRoom };
  }

  function refusals(room: PartyRoomClient): PartyRefusal[] {
    const list: PartyRefusal[] = [];
    room.onMessage(PartyServerMessage.Refused, (refusal: PartyRefusal) => list.push(refusal));
    return list;
  }

  async function readyAll(...entries: [PartyRoomClient, number][]) {
    const [first] = entries;
    if (!first) return;
    const revision = first[0].state.revision;
    for (const [room] of entries) room.send(PartyClientMessage.SetReady, { revision, ready: true });
    await waitFor(() => readyCount(first[0]) === entries.length, 'todos prontos');
  }

  it('needs a class to be ready and refuses an old revision', async () => {
    const leader = await player();
    const party = await enter(leader, { intent: 'create' });
    const refused = refusals(party);
    const revision = party.state.revision;
    party.send(PartyClientMessage.SetReady, { revision, ready: true });
    await waitFor(() => refused.length === 1, 'sem classe');
    expect(refused[0]?.code).toBe('class_missing');

    party.send(PartyClientMessage.SelectClass, { classId: 'class.medic' });
    await waitFor(() => party.state.revision > revision, 'nova revisão');
    party.send(PartyClientMessage.SetReady, { revision, ready: true });
    await waitFor(() => refused.length === 2, 'revisão antiga');
    expect(refused[1]?.code).toBe('stale_revision');

    party.send(PartyClientMessage.SetReady, { revision: party.state.revision, ready: true });
    await waitFor(() => memberOf(party, leader.id)?.ready === true, 'pronto');
  });

  it('clears everyone when a member changes class, ship, roster or loadout', async () => {
    const { guest, party, guestRoom } = await pair();

    await readyAll([party, 0], [guestRoom, 0]);
    let revision = party.state.revision;
    guestRoom.send(PartyClientMessage.SelectClass, { classId: 'class.medic' });
    await waitFor(() => readyCount(party) === 0, 'troca de classe');
    expect(party.state.revision).toBeGreaterThan(revision);

    // A loadout saved through the API reaches the party.
    await readyAll([party, 0], [guestRoom, 0]);
    revision = party.state.revision;
    const saved = await call(api.baseUrl, AccountRoute.MyLoadout, {
      method: 'PUT',
      origin: ALLOWED_ORIGIN,
      token: guest.token,
      body: { picks: [] },
    });
    expect(saved.status).toBe(200);
    await waitFor(() => readyCount(party) === 0, 'loadout salvo');
    expect(party.state.revision).toBeGreaterThan(revision);

    // A new member arriving.
    await readyAll([party, 0], [guestRoom, 0]);
    const third = await player();
    await enter(third, { intent: 'join', inviteCode: party.state.inviteCode });
    await waitFor(() => readyCount(party) === 0, 'novo membro');
  });

  it('refuses readiness while the saved loadout breaks a rule', async () => {
    const { guest, party, guestRoom } = await pair();
    await grantItem(api.db, {
      accountId: guest.id,
      itemId: ItemId.LongRifle,
      quantity: 1,
      origin: 'grant:test',
      reason: 'teste',
    });
    guestRoom.send(PartyClientMessage.SelectClass, { classId: 'class.officer' });
    await waitFor(() => memberOf(party, guest.id)?.classId === 'class.officer', 'oficial');
    const inventory = (await call(api.baseUrl, AccountRoute.MyInventory, { token: guest.token }))
      .body as InventoryResponse;
    const rifle = inventory.stash.find((entry) => entry.itemId === ItemId.LongRifle);
    await call(api.baseUrl, AccountRoute.MyLoadout, {
      method: 'PUT',
      origin: ALLOWED_ORIGIN,
      token: guest.token,
      body: { picks: [{ slot: 'primary', instanceId: rifle?.instanceId }] },
    });
    guestRoom.send(PartyClientMessage.SelectClass, { classId: 'class.pilot' });
    await waitFor(() => memberOf(party, guest.id)?.classId === 'class.pilot', 'piloto');

    const refused = refusals(guestRoom);
    guestRoom.send(PartyClientMessage.SetReady, {
      revision: guestRoom.state.revision,
      ready: true,
    });
    await waitFor(() => refused.length === 1, 'loadout inválido');
    expect(refused[0]?.code).toBe('loadout_invalid');
  });

  it('lets only the leader confirm, once everyone is ready, and any change undoes it', async () => {
    const { party, guestRoom } = await pair();
    const leaderRefusals = refusals(party);
    const guestRefusals = refusals(guestRoom);

    party.send(PartyClientMessage.Confirm, { revision: party.state.revision });
    await waitFor(() => leaderRefusals.length === 1, 'ninguém pronto');
    expect(leaderRefusals[0]?.code).toBe('members_not_ready');

    await readyAll([party, 0], [guestRoom, 0]);
    guestRoom.send(PartyClientMessage.Confirm, { revision: guestRoom.state.revision });
    await waitFor(() => guestRefusals.length === 1, 'não líder');
    expect(guestRefusals[0]?.code).toBe('not_leader');

    const revision = party.state.revision;
    party.send(PartyClientMessage.Confirm, { revision });
    await waitFor(() => guestRoom.state.confirmedRevision === revision, 'confirmada');

    guestRoom.send(PartyClientMessage.SetReady, { revision, ready: false });
    await waitFor(() => party.state.confirmedRevision === 0, 'confirmação desfeita');
  });

  it('never confirms a roster that changed at the same time', async () => {
    const { party, guestRoom } = await pair();

    // The guest changes class while the leader confirms the revision both saw.
    await readyAll([party, 0], [guestRoom, 0]);
    const seen = party.state.revision;
    guestRoom.send(PartyClientMessage.SelectClass, { classId: 'class.medic' });
    party.send(PartyClientMessage.Confirm, { revision: seen });
    await waitFor(() => party.state.revision > seen && readyCount(party) === 0, 'mudança aplicada');
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(party.state.confirmedRevision).toBe(0);

    // The leader changes the ship while the guest gets ready on the old revision.
    const refused = refusals(guestRoom);
    const before = party.state.revision;
    party.send(PartyClientMessage.SelectShip, { shipId: 'ship.scout' }); // unchanged: no new revision
    party.send(PartyClientMessage.SetReady, { revision: before, ready: true });
    await waitFor(() => memberOf(party, party.state.leaderId)?.ready === true, 'líder pronto');
    expect(party.state.revision).toBe(before);
    guestRoom.leave().catch(() => undefined);
    rooms = rooms.filter((room) => room !== guestRoom);
    await waitFor(() => party.state.members.size === 1, 'convidado saiu');
    expect(readyCount(party)).toBe(0);
    party.send(PartyClientMessage.Confirm, { revision: before });
    const leaderRefusals = refusals(party);
    await waitFor(() => leaderRefusals.length === 1, 'confirmação antiga');
    expect(leaderRefusals[0]?.code).toBe('stale_revision');
    expect(refused).toEqual([]);
  });
});
