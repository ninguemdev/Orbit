import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Client, type Room } from '@colyseus/sdk';
import { ItemId, ShipHullId } from '@orbit/catalog';
import {
  AccountRoute,
  type ExpeditionEndedNotice,
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
import {
  cancelPreparation,
  getActiveExpedition,
  grantItem,
  startExpedition,
  updateProfileClass,
} from '@orbit/database';
import { ExpeditionService } from '../src/modules/expedition/expedition-service';
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

async function eventually(check: () => Promise<boolean>, label: string, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error(`Tempo esgotado aguardando ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
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

/** Party flows against one API server; `prepareSeconds` is the preparation deadline. */
function partyHelpers(get: () => ApiServer) {
  let counter = 0;
  const rooms: PartyRoomClient[] = [];

  async function player(): Promise<Player> {
    const response = await call(get().baseUrl, AccountRoute.Accounts, {
      method: 'POST',
      origin: ALLOWED_ORIGIN,
      body: {
        nick: `Exped_${randomUUID().slice(0, 4)}${++counter}`,
        password: 'senha de expedicao longa',
      },
    });
    return {
      id: (response.body as { account: { id: string } }).account.id,
      token: response.token ?? '',
    };
  }

  async function enter(who: Player, body: unknown): Promise<PartyRoomClient> {
    const issued = (
      await call(get().baseUrl, PartyRoute.Tickets, {
        method: 'POST',
        origin: ALLOWED_ORIGIN,
        token: who.token,
        body,
      })
    ).body as PartyTicketResponse;
    const client = new Client(get().baseUrl);
    client.auth.token = issued.ticket;
    const room = issued.roomId
      ? await client.joinById<PartyStateView>(issued.roomId)
      : await client.create<PartyStateView>(PARTY_ROOM_NAME);
    rooms.push(room);
    await waitFor(() => memberOf(room, who.id) !== undefined, 'entrada na party');
    return room;
  }

  async function inventory(who: Player): Promise<InventoryResponse> {
    return (await call(get().baseUrl, AccountRoute.MyInventory, { token: who.token }))
      .body as InventoryResponse;
  }

  /** Grants a pistol and saves it as the sidearm; returns its instance ID. */
  async function equipPistol(who: Player): Promise<string> {
    await grantItem(get().db, {
      accountId: who.id,
      itemId: ItemId.Pistol,
      quantity: 1,
      origin: 'grant:test',
      reason: 'teste',
    });
    const pistol = (await inventory(who)).stash.find((entry) => entry.itemId === ItemId.Pistol);
    const saved = await call(get().baseUrl, AccountRoute.MyLoadout, {
      method: 'PUT',
      origin: ALLOWED_ORIGIN,
      token: who.token,
      body: { picks: [{ slot: 'sidearm', instanceId: pistol?.instanceId }] },
    });
    expect(saved.status).toBe(200);
    return pistol?.instanceId ?? '';
  }

  /** Leader and guest with classes and a pistol each, both ready on the same revision. */
  async function readyPair() {
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
    const before = party.state.revision;
    const pistols = { leader: await equipPistol(leader), guest: await equipPistol(guest) };
    // Each saved loadout reaches the party as a new revision.
    await waitFor(
      () => party.state.revision >= before + 2 && guestRoom.state.revision >= before + 2,
      'loadouts na party',
    );
    await readyAll(party, guestRoom);
    return { leader, guest, party, guestRoom, pistols };
  }

  async function readyAll(...entries: PartyRoomClient[]) {
    const [first] = entries;
    if (!first) return;
    await waitFor(
      () => entries.every((room) => room.state.revision === first.state.revision),
      'mesma revisão',
    );
    const revision = first.state.revision;
    for (const room of entries) room.send(PartyClientMessage.SetReady, { revision, ready: true });
    await waitFor(() => readyCount(first) === entries.length, 'todos prontos');
  }

  async function confirm(party: PartyRoomClient) {
    party.send(PartyClientMessage.Confirm, { revision: party.state.revision });
    await waitFor(() => party.state.expeditionState === 'PREPARING', 'expedição em preparação');
  }

  function messages<T>(room: PartyRoomClient, type: string): T[] {
    const list: T[] = [];
    room.onMessage(type, (message: T) => list.push(message));
    return list;
  }

  async function leaveAll() {
    // leave() on a room that already closed never resolves.
    const open = rooms.splice(0).filter((room) => room.connection.isOpen);
    await Promise.all(open.map((room) => room.leave().catch(() => undefined)));
  }

  return {
    player,
    enter,
    inventory,
    equipPistol,
    readyPair,
    readyAll,
    confirm,
    messages,
    leaveAll,
  };
}

const POLICY = {
  ...DEFAULT_IDENTITY_POLICY,
  loginAttemptsPerAddress: 1000,
  signUpsPerAddress: 1000,
};

describe('party confirmation reserves the expedition', () => {
  let api: ApiServer;
  const h = partyHelpers(() => api);

  beforeAll(async () => {
    api = await startApiServer(POLICY);
  });

  afterEach(async () => {
    await h.leaveAll();
  });

  afterAll(async () => {
    await api?.close();
  });

  it('reserves every loadout and keeps it fixed while preparing', async () => {
    const { leader, guest, party, guestRoom, pistols } = await h.readyPair();
    await h.confirm(party);
    expect(party.state.confirmedRevision).toBe(party.state.revision);
    expect(party.state.prepareDeadline).toBeGreaterThan(Date.now() + 20_000);
    await waitFor(() => guestRoom.state.expeditionId === party.state.expeditionId, 'convidado vê');

    for (const [who, pistol] of [
      [leader, pistols.leader],
      [guest, pistols.guest],
    ] as const) {
      const active = await getActiveExpedition(api.db, who.id);
      expect(active?.expeditionId).toBe(party.state.expeditionId);
      expect(active?.reserved.map((item) => item.instanceId)).toEqual([pistol]);
      const stash = (await h.inventory(who)).stash;
      expect(stash.find((entry) => entry.instanceId === pistol)?.reserved).toBe(true);
    }

    const changed = await call(api.baseUrl, AccountRoute.MyLoadout, {
      method: 'PUT',
      origin: ALLOWED_ORIGIN,
      token: guest.token,
      body: { picks: [] },
    });
    expect(changed.status).toBe(409);
    expect(changed.body).toEqual({ error: 'in_expedition' });

    // Confirming the same revision again keeps the same expedition.
    const id = party.state.expeditionId;
    party.send(PartyClientMessage.Confirm, { revision: party.state.revision });
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(party.state.expeditionId).toBe(id);
    expect((await getActiveExpedition(api.db, leader.id))?.expeditionId).toBe(id);
  });

  it('cancels the preparation and returns the items when the party changes', async () => {
    const { leader, guest, party, guestRoom, pistols } = await h.readyPair();
    const ended = h.messages<ExpeditionEndedNotice>(guestRoom, PartyServerMessage.ExpeditionEnded);
    await h.confirm(party);
    const first = party.state.expeditionId;
    const revision = party.state.revision;

    guestRoom.send(PartyClientMessage.SetReady, { revision, ready: false });
    await waitFor(() => ended.length === 1, 'aviso de cancelamento');
    expect(ended[0]).toEqual({ reason: 'party_changed' });
    await waitFor(() => party.state.expeditionId === '', 'preparação desfeita');
    expect(party.state.revision).toBeGreaterThan(revision);
    expect(readyCount(party)).toBe(0);
    await eventually(
      async () => (await getActiveExpedition(api.db, guest.id)) === null,
      'reservas devolvidas',
    );
    const stash = (await h.inventory(guest)).stash;
    expect(stash.find((entry) => entry.instanceId === pistols.guest)?.reserved).toBe(false);

    // The next confirmation is a new expedition with the same items.
    await h.readyAll(party, guestRoom);
    await h.confirm(party);
    expect(party.state.expeditionId).not.toBe(first);
    expect((await getActiveExpedition(api.db, leader.id))?.reserved).toHaveLength(1);
  });

  it('cancels the preparation when a member leaves the party', async () => {
    const { guest, party, guestRoom } = await h.readyPair();
    await h.confirm(party);
    await guestRoom.leave();
    await waitFor(() => party.state.expeditionId === '', 'preparação desfeita');
    await eventually(
      async () => (await getActiveExpedition(api.db, guest.id)) === null,
      'reservas devolvidas',
    );
  });

  it('refuses the confirmation when a member is in another expedition', async () => {
    const { leader, guest, party, pistols } = await h.readyPair();
    const refused = h.messages<PartyRefusal>(party, PartyServerMessage.Refused);
    // Another expedition (e.g. left by an earlier process) already holds the guest.
    const other = await startExpedition(api.db, {
      startKey: randomUUID(),
      leaderAccountId: guest.id,
      shipId: ShipHullId.Scout,
      members: [
        {
          accountId: guest.id,
          classId: 'class.engineer',
          loadout: [{ slot: 'sidearm', instanceId: pistols.guest }],
        },
      ],
    });
    if (!other.ok) throw new Error(other.reason);

    party.send(PartyClientMessage.Confirm, { revision: party.state.revision });
    await waitFor(() => refused.length === 1, 'recusa');
    expect(refused[0]?.code).toBe('member_in_expedition');
    expect(party.state.expeditionId).toBe('');
    expect(await getActiveExpedition(api.db, leader.id)).toBeNull();
    expect(await cancelPreparation(api.db, other.expeditionId)).toBe('cancelled');
  });
});

describe('preparation deadline', () => {
  let api: ApiServer;
  const h = partyHelpers(() => api);

  beforeAll(async () => {
    api = await startApiServer(POLICY, {}, { prepareSeconds: 1 });
  });

  afterEach(async () => {
    await h.leaveAll();
  });

  afterAll(async () => {
    await api?.close();
  });

  it('cancels a preparation that does not start in time', async () => {
    const { leader, party, guestRoom } = await h.readyPair();
    const ended = h.messages<ExpeditionEndedNotice>(guestRoom, PartyServerMessage.ExpeditionEnded);
    const revision = party.state.revision;
    await h.confirm(party);

    await waitFor(() => ended.length === 1, 'prazo vencido', 5000);
    expect(ended[0]).toEqual({ reason: 'expired' });
    await waitFor(() => party.state.expeditionId === '', 'preparação desfeita');
    expect(party.state.revision).toBeGreaterThan(revision);
    expect(readyCount(party)).toBe(0);
    expect(await getActiveExpedition(api.db, leader.id)).toBeNull();
  });

  it('cancels, after a restart, the preparations the previous process left', async () => {
    const leader = await h.player();
    await updateProfileClass(api.db, leader.id, 'class.pilot');
    const pistol = await h.equipPistol(leader);
    const started = await startExpedition(api.db, {
      startKey: randomUUID(),
      leaderAccountId: leader.id,
      shipId: ShipHullId.Scout,
      members: [
        {
          accountId: leader.id,
          classId: 'class.pilot',
          loadout: [{ slot: 'sidearm', instanceId: pistol }],
        },
      ],
      prepareSeconds: 1,
    });
    if (!started.ok) throw new Error(started.reason);

    // A new process finds it without a room and cancels it at its deadline.
    const restarted = new ExpeditionService(api.db);
    try {
      expect(await restarted.recoverPreparations()).toBeGreaterThanOrEqual(1);
      await eventually(
        async () => (await getActiveExpedition(api.db, leader.id)) === null,
        'preparação órfã cancelada',
      );
    } finally {
      restarted.close();
    }
    const stash = (await h.inventory(leader)).stash;
    expect(stash.find((entry) => entry.instanceId === pistol)?.reserved).toBe(false);
  });
});
