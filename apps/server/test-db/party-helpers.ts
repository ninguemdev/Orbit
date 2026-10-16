import { randomUUID } from 'node:crypto';
import { expect } from 'vitest';
import { Client, type Room } from '@colyseus/sdk';
import { ItemId } from '@orbit/catalog';
import {
  AccountRoute,
  type InventoryResponse,
  PARTY_ROOM_NAME,
  PartyClientMessage,
  type PartyMemberView,
  PartyRoute,
  type PartyStateView,
  type PartyTicketResponse,
} from '@orbit/contracts';
import { grantItem, grantShipLicense } from '@orbit/database';
import { DEFAULT_IDENTITY_POLICY } from '../src/modules/identity/identity-service';
import { ALLOWED_ORIGIN, type ApiServer, call } from './api-harness';

export type PartyRoomClient = Room<unknown, PartyStateView>;

export interface Player {
  readonly id: string;
  readonly token: string;
}

export async function waitFor(predicate: () => boolean, label: string, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`Tempo esgotado aguardando ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

export async function eventually(check: () => Promise<boolean>, label: string, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error(`Tempo esgotado aguardando ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

export const memberOf = (room: PartyRoomClient, id: string) => {
  let found: PartyMemberView | undefined;
  room.state.members?.forEach((member, memberId) => {
    if (memberId === id) found = member;
  });
  return found;
};
export const readyCount = (room: PartyRoomClient) => {
  let count = 0;
  room.state.members?.forEach((member) => (count += member.ready ? 1 : 0));
  return count;
};

/** Party flows against one API server: accounts, parties, loadouts and readiness. */
export function partyHelpers(get: () => ApiServer) {
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

  /**
   * Leader and guest with classes and a pistol each, both ready on the same revision.
   * `guestShips` are licensed to the guest before entering, so the party offers them.
   */
  async function readyPair({ guestShips = [] }: { guestShips?: readonly string[] } = {}) {
    const [leader, guest] = [await player(), await player()];
    for (const shipId of guestShips) {
      await grantShipLicense(get().db, guest.id, shipId, 'grant:test');
    }
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

export const POLICY = {
  ...DEFAULT_IDENTITY_POLICY,
  loginAttemptsPerAddress: 1000,
  signUpsPerAddress: 1000,
};
