import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Client, type Room } from '@colyseus/sdk';
import { SectorId, ShipHullId } from '@orbit/catalog';
import {
  type ExpeditionEndedNotice,
  MISSION_CANCELLED_CLOSE_CODE,
  MISSION_ROOM_NAME,
  MissionRoute,
  type MissionTicketResponse,
  PartyClientMessage,
  type PartyRefusal,
  PartyServerMessage,
  RoomPhase,
  type SectorStateView,
} from '@orbit/contracts';
import {
  activateExpedition,
  getActiveExpedition,
  startExpedition,
  updateProfileClass,
} from '@orbit/database';
import { ExpeditionService } from '../src/modules/expedition/expedition-service';
import { generateOpenSector, newSectorSeed } from '../src/simulation/sector-generator';
import { ALLOWED_ORIGIN, type ApiServer, call, startApiServer } from './api-harness';
import { POLICY, type Player, eventually, partyHelpers, waitFor } from './party-helpers';

type MissionRoomClient = Room<unknown, SectorStateView>;

function missionHelpers(get: () => ApiServer) {
  const rooms: MissionRoomClient[] = [];

  async function ticketFor(who: Player) {
    return call(get().baseUrl, MissionRoute.Tickets, {
      method: 'POST',
      origin: ALLOWED_ORIGIN,
      token: who.token,
      body: {},
    });
  }

  async function joinWith(issued: MissionTicketResponse): Promise<MissionRoomClient> {
    const client = new Client(get().baseUrl);
    client.auth.token = issued.ticket;
    const room = await client.joinById<SectorStateView>(issued.roomId);
    rooms.push(room);
    return room;
  }

  async function enterMission(who: Player): Promise<MissionRoomClient> {
    const issued = await ticketFor(who);
    expect(issued.status).toBe(201);
    return joinWith(issued.body as MissionTicketResponse);
  }

  const crewNames = (room: MissionRoomClient) => {
    const names: string[] = [];
    room.state.crew?.forEach((member) => names.push(member.name));
    return names.sort();
  };

  async function leaveAll() {
    // leave() on a room that already closed never resolves.
    const open = rooms.splice(0).filter((room) => room.connection.isOpen);
    await Promise.all(open.map((room) => room.leave().catch(() => undefined)));
  }

  return { ticketFor, joinWith, enterMission, crewNames, leaveAll };
}

const closeCode = (room: MissionRoomClient) =>
  new Promise<number>((resolve) => room.onLeave((code) => resolve(code)));

describe('mission room', () => {
  let api: ApiServer;
  const party = partyHelpers(() => api);
  const mission = missionHelpers(() => api);
  /** Seeds handed to mission rooms, in order: only the test knows them. */
  const seeds: string[] = [];

  beforeAll(async () => {
    api = await startApiServer(POLICY, {
      sectorSeed: () => {
        const seed = newSectorSeed();
        seeds.push(seed);
        return seed;
      },
    });
  });

  afterEach(async () => {
    await mission.leaveAll();
    await party.leaveAll();
  });

  afterAll(async () => {
    await api?.close();
  });

  it('starts the match when the whole roster has loaded', async () => {
    const { leader, guest, party: leaderParty, guestRoom } = await party.readyPair();
    await party.confirm(leaderParty);

    const first = await mission.enterMission(leader);
    // One member is not enough: still preparing.
    await waitFor(() => mission.crewNames(first).length === 1, 'líder a bordo');
    expect(first.state.phase).toBe(RoomPhase.Preparing);
    expect((await getActiveExpedition(api.db, leader.id))?.state).toBe('PREPARING');

    await mission.enterMission(guest);
    await waitFor(() => first.state.phase === RoomPhase.Active, 'partida ativa');
    expect(mission.crewNames(first)).toHaveLength(2);
    expect((await getActiveExpedition(api.db, guest.id))?.state).toBe('ACTIVE');
    await waitFor(() => guestRoom.state.expeditionState === 'ACTIVE', 'party vê a partida');
    expect(leaderParty.state.prepareSecondsLeft).toBe(0);
  });

  it('builds the sector from a private seed and brings the ship the leader chose', async () => {
    const pair = await party.readyPair({ guestShips: [ShipHullId.Hauler] });
    // Only the guest is licensed for the hauler; the union lets the leader pick it.
    pair.party.send(PartyClientMessage.SelectShip, { shipId: ShipHullId.Hauler });
    await waitFor(() => pair.guestRoom.state.selectedShipId === ShipHullId.Hauler, 'nave');
    await party.readyAll(pair.party, pair.guestRoom);
    await party.confirm(pair.party);

    const room = await mission.enterMission(pair.leader);
    await waitFor(() => (room.state.layout?.containers?.length ?? 0) > 0, 'setor recebido');
    const seed = seeds.at(-1) ?? '';
    const sector = generateOpenSector(seed);
    expect(room.state.sectorId).toBe(SectorId.Open);
    expect(room.state.ship.hullId).toBe(ShipHullId.Hauler);
    expect(room.state.ship.x).toBeCloseTo(sector.shipSpawn.position.x, 1);
    expect(room.state.ship.y).toBeCloseTo(sector.shipSpawn.position.y, 1);

    // The client gets the geometry the seed produced, and nothing else.
    const { layout } = room.state;
    expect(layout.maxX - layout.minX).toBe(12_000);
    expect(layout.asteroids.length).toBe(sector.obstacles.length);
    const containers: { id: string; x: number; y: number }[] = [];
    layout.containers.forEach(({ id, x, y }) => containers.push({ id, x, y }));
    expect(containers).toEqual(
      sector.containers.map(({ id, x, y }) => ({
        id,
        x: Math.fround(x),
        y: Math.fround(y),
      })),
    );
    expect(layout.extractionZones.length).toBe(1);
    const visible = JSON.stringify((room.state as unknown as { toJSON(): unknown }).toJSON());
    expect(visible).not.toContain(seed);
    expect(visible).not.toMatch(/seed/i);
  });

  it('keeps outsiders, replays, duplicates and client-made rooms out', async () => {
    const { leader, guest, party: leaderParty } = await party.readyPair();
    await party.confirm(leaderParty);

    // An account outside the expedition gets no ticket.
    const outsider = await party.player();
    const refused = await mission.ticketFor(outsider);
    expect(refused.status).toBe(404);
    expect(refused.body).toEqual({ error: 'no_mission' });

    const issued = (await mission.ticketFor(leader)).body as MissionTicketResponse;
    // No ticket, an invented one, or a client trying to create a mission room.
    const anonymous = new Client(api.baseUrl);
    await expect(anonymous.joinById(issued.roomId)).rejects.toThrow();
    anonymous.auth.token = 'inventado';
    await expect(anonymous.joinById(issued.roomId)).rejects.toThrow();
    const creator = new Client(api.baseUrl);
    creator.auth.token = ((await mission.ticketFor(guest)).body as MissionTicketResponse).ticket;
    await expect(
      creator.create(MISSION_ROOM_NAME, { expeditionId: leaderParty.state.expeditionId }),
    ).rejects.toThrow();

    // The ticket enters once; the same ticket again is refused.
    const room = await mission.joinWith(issued);
    await waitFor(() => mission.crewNames(room).length === 1, 'líder a bordo');
    await expect(mission.joinWith(issued)).rejects.toThrow();
    // A second connection of the same account does not duplicate the character.
    await expect(mission.enterMission(leader)).rejects.toThrow();
    expect(mission.crewNames(room)).toHaveLength(1);

    // The guest's ticket used by the creator attempt is gone; a new one works.
    await mission.enterMission(guest);
    await waitFor(() => room.state.phase === RoomPhase.Active, 'partida ativa');
  });

  it('ends the match as a technical abort when everyone leaves', async () => {
    const { leader, guest, party: leaderParty, guestRoom, pistols } = await party.readyPair();
    const ended = party.messages<ExpeditionEndedNotice>(
      guestRoom,
      PartyServerMessage.ExpeditionEnded,
    );
    await party.confirm(leaderParty);
    const revision = leaderParty.state.revision;
    const rooms = [await mission.enterMission(leader), await mission.enterMission(guest)];
    await waitFor(() => rooms[0]?.state.phase === RoomPhase.Active, 'partida ativa');
    const expeditionId = leaderParty.state.expeditionId;

    await Promise.all(rooms.map((room) => room.leave()));
    await waitFor(() => ended.length === 1, 'aviso de encerramento');
    expect(ended[0]).toEqual({ reason: 'aborted' });
    expect(await getActiveExpedition(api.db, leader.id)).toBeNull();
    const state = await api.pool.query<{ state: string }>(
      'SELECT state FROM expeditions WHERE id = $1',
      [expeditionId],
    );
    expect(state.rows[0]?.state).toBe('ABORTED_TECHNICAL');
    const stash = (await party.inventory(guest)).stash;
    expect(stash.find((entry) => entry.instanceId === pistols.guest)?.reserved).toBe(false);
    await waitFor(() => leaderParty.state.expeditionId === '', 'party livre');
    await waitFor(() => leaderParty.state.revision > revision, 'revisão nova');
  });

  it("keeps a running match out of the party's confirmations and changes", async () => {
    const { leader, guest, party: leaderParty, guestRoom } = await party.readyPair();
    const ended = party.messages<ExpeditionEndedNotice>(
      guestRoom,
      PartyServerMessage.ExpeditionEnded,
    );
    const refused = party.messages<PartyRefusal>(leaderParty, PartyServerMessage.Refused);
    await party.confirm(leaderParty);
    const expeditionId = leaderParty.state.expeditionId;
    const room = await mission.enterMission(leader);
    await mission.enterMission(guest);
    await waitFor(() => leaderParty.state.expeditionState === 'ACTIVE', 'partida ativa');
    // Party and mission room patch independently.
    await waitFor(() => room.state.phase === RoomPhase.Active, 'sala ativa');

    // Confirming again, even the old revision, does not take the match back.
    leaderParty.send(PartyClientMessage.Confirm, { revision: leaderParty.state.revision });
    await waitFor(() => refused.length === 1, 'recusa');
    expect(refused[0]?.code).toBe('member_in_expedition');
    // A party change during the match does not claim the items went back.
    guestRoom.send(PartyClientMessage.SelectClass, { classId: 'class.medic' });
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(ended).toHaveLength(0);
    expect(leaderParty.state.expeditionId).toBe(expeditionId);
    expect((await getActiveExpedition(api.db, guest.id))?.state).toBe('ACTIVE');
    // Who joins the party during the match is not part of it.
    const latecomer = await party.player();
    const lateRoom = await party.enter(latecomer, {
      intent: 'join',
      inviteCode: leaderParty.state.inviteCode,
    });
    await waitFor(() => lateRoom.state.expeditionState === 'ACTIVE', 'recém-chegado vê a partida');
    const memberIds: string[] = [];
    lateRoom.state.expeditionMemberIds.forEach((id) => memberIds.push(id));
    expect(memberIds.sort()).toEqual([leader.id, guest.id].sort());
    expect((await mission.ticketFor(latecomer)).status).toBe(404);
    // Recovery of the same process leaves its own match alone.
    expect((await api.expeditions.recover()).running).toBe(0);
    expect((await getActiveExpedition(api.db, guest.id))?.state).toBe('ACTIVE');
  });

  it('lets a loader who dropped enter again at once, and counts only who is aboard', async () => {
    const { leader, guest, party: leaderParty } = await party.readyPair();
    await party.confirm(leaderParty);
    const dropped = await mission.enterMission(leader);
    await waitFor(() => mission.crewNames(dropped).length === 1, 'líder a bordo');
    // The page dies without leaving (no consented leave).
    await dropped.leave(false);

    const room = await mission.enterMission(guest);
    await waitFor(() => mission.crewNames(room).length === 1, 'só o convidado a bordo');
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(room.state.phase).toBe(RoomPhase.Preparing);

    // A new ticket gets the leader back right away.
    await mission.enterMission(leader);
    await waitFor(() => room.state.phase === RoomPhase.Active, 'partida ativa');
  });

  it('limits mission tickets per account', async () => {
    const { leader, party: leaderParty } = await party.readyPair();
    await party.confirm(leaderParty);
    const statuses: number[] = [];
    for (let i = 0; i < 31; i++) statuses.push((await mission.ticketFor(leader)).status);
    expect(statuses.slice(0, 30).every((status) => status === 201)).toBe(true);
    expect(statuses[30]).toBe(429);
  });
});

describe('mission room deadline', () => {
  let api: ApiServer;
  const party = partyHelpers(() => api);
  const mission = missionHelpers(() => api);

  beforeAll(async () => {
    api = await startApiServer(POLICY, {}, { prepareSeconds: 2 });
  });

  afterEach(async () => {
    await mission.leaveAll();
    await party.leaveAll();
  });

  afterAll(async () => {
    await api?.close();
  });

  it('cancels and closes the room when someone fails to load in time', async () => {
    const { leader, guest, party: leaderParty, guestRoom, pistols } = await party.readyPair();
    const ended = party.messages<ExpeditionEndedNotice>(
      guestRoom,
      PartyServerMessage.ExpeditionEnded,
    );
    await party.confirm(leaderParty);
    const room = await mission.enterMission(leader);
    const closed = closeCode(room);
    // The guest never loads.

    expect(await closed).toBe(MISSION_CANCELLED_CLOSE_CODE);
    await waitFor(() => ended.length === 1, 'aviso de prazo');
    expect(ended[0]).toEqual({ reason: 'expired' });
    expect(await getActiveExpedition(api.db, leader.id)).toBeNull();
    const stash = (await party.inventory(guest)).stash;
    expect(stash.find((entry) => entry.instanceId === pistols.guest)?.reserved).toBe(false);
    // Nothing left to enter.
    expect((await mission.ticketFor(guest)).status).toBe(404);
  });

  it('lets a member whose load failed try again with a new ticket', async () => {
    const { leader, guest, party: leaderParty } = await party.readyPair();
    await party.confirm(leaderParty);
    const room = await mission.enterMission(leader);
    // The first ticket is lost (the page failed to load); the member asks again.
    expect((await mission.ticketFor(guest)).status).toBe(201);
    await mission.enterMission(guest);
    await waitFor(() => room.state.phase === RoomPhase.Active, 'partida ativa');
    // Past the deadline the match keeps running: the deadline only applies to loading.
    await new Promise((resolve) => setTimeout(resolve, 2500));
    expect((await getActiveExpedition(api.db, leader.id))?.state).toBe('ACTIVE');
    expect(room.connection.isOpen).toBe(true);
  });

  it('aborts, after a restart, the matches the previous process left running', async () => {
    const leader = await party.player();
    await updateProfileClass(api.db, leader.id, 'class.pilot');
    const pistol = await party.equipPistol(leader);
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
    });
    if (!started.ok) throw new Error(started.reason);
    expect(await activateExpedition(api.db, started.expeditionId)).toBe('activated');

    const restarted = new ExpeditionService(api.db);
    try {
      expect((await restarted.recover()).running).toBeGreaterThanOrEqual(1);
      await eventually(
        async () => (await getActiveExpedition(api.db, leader.id)) === null,
        'partida órfã encerrada',
      );
    } finally {
      await restarted.close();
    }
  });
});

describe('mission activation failure', () => {
  let api: ApiServer;
  const party = partyHelpers(() => api);
  const mission = missionHelpers(() => api);
  let failures = 0;

  beforeAll(async () => {
    api = await startApiServer(
      POLICY,
      {},
      {
        wrapExpeditions: (service) => ({
          start: (request, watcher) => service.start(request, watcher),
          cancel: (expeditionId, reason) => service.cancel(expeditionId, reason),
          watch: (expeditionId, watcher) => service.watch(expeditionId, watcher),
          roster: (expeditionId) => service.roster(expeditionId),
          activate: async (expeditionId) => {
            if (failures > 0) {
              failures--;
              throw new Error('banco indisponível');
            }
            return service.activate(expeditionId);
          },
          abort: (expeditionId) => service.abort(expeditionId),
        }),
      },
    );
  });

  afterEach(async () => {
    await mission.leaveAll();
    await party.leaveAll();
  });

  afterAll(async () => {
    await api?.close();
  });

  it('tries the activation again when the database fails', async () => {
    const { leader, guest, party: leaderParty } = await party.readyPair();
    await party.confirm(leaderParty);
    failures = 2;
    const room = await mission.enterMission(leader);
    await mission.enterMission(guest);
    await waitFor(() => room.state.phase === RoomPhase.Active, 'partida ativa', 8000);
    expect(failures).toBe(0);
    expect((await getActiveExpedition(api.db, leader.id))?.state).toBe('ACTIVE');
  });
});
