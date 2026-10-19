import { createHash } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Client, type Room } from '@colyseus/sdk';
import { CREW, SHIP_HULLS, type SectorDefinition, SectorId, ShipHullId } from '@orbit/catalog';
import {
  type ActionRejectedPayload,
  ClientMessage,
  ErrorCode,
  MissionRoute,
  type MissionInventoryView,
  type MissionTicketResponse,
  RoomPhase,
  type SectorStateView,
  ServerMessage,
  TICK_RATE_HZ,
} from '@orbit/contracts';
import { type Vec2, distance, normalize, scale, sub } from '@orbit/simulation';
import { ALLOWED_ORIGIN, type ApiServer, call, startApiServer } from './api-harness';
import { POLICY, type Player, partyHelpers, waitFor } from './party-helpers';

const HULL = SHIP_HULLS[ShipHullId.Scout];
const HATCH = HULL.cargoHatch.position;
const SEED = createHash('sha256').update('teste-loot').digest('hex');

/** Container 1 floats alongside the spawn; container 2 is across the sector. */
const SECTOR: SectorDefinition = {
  id: SectorId.Open,
  bounds: { minX: -6000, minY: -6000, maxX: 6000, maxY: 6000 },
  obstacles: [],
  containers: [
    { id: 'container.1', x: 0, y: HULL.handling.radius + 36 + 100, radius: 36 },
    { id: 'container.2', x: 4000, y: 4000, radius: 36 },
  ],
  extractionZones: [{ id: 'extraction.1', x: -4000, y: 0, radius: 600 }],
  shipSpawn: { position: { x: 0, y: 0 }, angle: 0 },
};

type MissionRoomClient = Room<unknown, SectorStateView>;

interface Crew {
  readonly room: MissionRoomClient;
  readonly views: MissionInventoryView[];
  readonly refusals: ActionRejectedPayload[];
  seq: number;
}

describe('mission loot', () => {
  let api: ApiServer;
  const party = partyHelpers(() => api);
  const rooms: MissionRoomClient[] = [];

  beforeAll(async () => {
    api = await startApiServer(POLICY, { sectorSeed: () => SEED, generateSector: () => SECTOR });
  });

  afterEach(async () => {
    const open = rooms.splice(0).filter((room) => room.connection.isOpen);
    await Promise.all(open.map((room) => room.leave().catch(() => undefined)));
    await party.leaveAll();
  });

  afterAll(async () => {
    await api?.close();
  });

  async function enter(who: Player): Promise<Crew> {
    const issued = await call(api.baseUrl, MissionRoute.Tickets, {
      method: 'POST',
      origin: ALLOWED_ORIGIN,
      token: who.token,
      body: {},
    });
    const { ticket, roomId } = issued.body as MissionTicketResponse;
    const client = new Client(api.baseUrl);
    client.auth.token = ticket;
    const room = await client.joinById<SectorStateView>(roomId);
    rooms.push(room);
    const crew: Crew = { room, views: [], refusals: [], seq: 0 };
    room.onMessage(ServerMessage.Inventory, (view: MissionInventoryView) => crew.views.push(view));
    room.onMessage(ServerMessage.ActionRejected, (refusal: ActionRejectedPayload) =>
      crew.refusals.push(refusal),
    );
    return crew;
  }

  const latest = (crew: Crew) => crew.views.at(-1);

  function position(crew: Crew): Vec2 {
    const member = crew.room.state.crew as unknown as Map<string, { x: number; y: number }>;
    const self = member.get(crew.room.sessionId);
    return { x: self?.x ?? 0, y: self?.y ?? 0 };
  }

  /** Walks with direction inputs only; the server decides where the member ends up. */
  async function walkTo(crew: Crew, target: Vec2) {
    // One tick of walking; closer than that, a smaller input lands on the target
    // instead of stepping back and forth across it.
    const step = CREW.walkSpeed / TICK_RATE_HZ;
    const deadline = Date.now() + 5000;
    while (distance(position(crew), target) > 4) {
      if (Date.now() > deadline) throw new Error('Tempo esgotado andando até a eclusa');
      const offset = sub(target, position(crew));
      const intent = scale(normalize(offset), Math.min(1, distance(offset, { x: 0, y: 0 }) / step));
      crew.room.send(ClientMessage.CrewInput, { seq: crew.seq++, ...intent });
      await new Promise((resolve) => setTimeout(resolve, 40));
    }
    crew.room.send(ClientMessage.CrewInput, { seq: crew.seq++, x: 0, y: 0 });
  }

  function transfer(crew: Crew, payload: Record<string, unknown>) {
    crew.room.send(ClientMessage.InventoryTransfer, payload);
  }

  async function refusalOf(crew: Crew, count: number) {
    await waitFor(() => crew.refusals.length >= count, 'recusa');
    return crew.refusals[count - 1]?.code;
  }

  async function startMatch() {
    const pair = await party.readyPair();
    await party.confirm(pair.party);
    const leader = await enter(pair.leader);
    const guest = await enter(pair.guest);
    await waitFor(() => leader.room.state.phase === RoomPhase.Active, 'partida ativa');
    await waitFor(() => latest(leader) !== undefined && latest(guest) !== undefined, 'inventários');
    return { ...pair, leader, guest };
  }

  it('sends each member only their own gear, and the container only at the hatch', async () => {
    const { leader, guest, pistols } = await startMatch();
    const own = latest(leader);
    expect(own?.equipment).toEqual([
      expect.objectContaining({ id: pistols.leader, quantity: 1, mine: true }),
    ]);
    expect(own?.atHatch).toBe(false);
    expect(own?.container).toBeNull();
    // Neither the leader's gear nor any container contents reach the guest.
    const guestSeen = JSON.stringify(guest.views);
    expect(guestSeen).not.toContain(pistols.leader);
    expect(guestSeen).not.toContain('loot_');

    await walkTo(leader, HATCH);
    await waitFor(() => latest(leader)?.container?.id === 'container.1', 'contêiner ao alcance');
    expect(latest(leader)?.container?.items.length).toBeGreaterThan(0);
    expect(JSON.stringify(guest.views)).not.toContain('loot_');
  });

  it('gives a contested stack to one collector, with the total preserved', async () => {
    const { leader, guest } = await startMatch();
    await Promise.all([
      walkTo(leader, { x: HATCH.x, y: HATCH.y - 12 }),
      walkTo(guest, { x: HATCH.x, y: HATCH.y + 12 }),
    ]);
    await waitFor(
      () => latest(leader)?.container !== null && latest(guest)?.container !== null,
      'os dois na eclusa',
    );
    const stack = latest(leader)?.container?.items[0];
    if (!stack) throw new Error('contêiner vazio');
    const request = {
      item: stack.id,
      from: 'container.1',
      to: 'backpack',
      quantity: stack.quantity,
    };
    // Both ask for the whole stack at once.
    transfer(leader, request);
    transfer(guest, request);

    const holds = (crew: Crew) =>
      latest(crew)?.backpack.items.filter((item) => item.id === stack.id).length ?? 0;
    await waitFor(() => holds(leader) + holds(guest) === 1, 'um coletor');
    const loser = holds(leader) === 1 ? guest : leader;
    expect(await refusalOf(loser, 1)).toBe(ErrorCode.ItemNotFound);
    const remaining = latest(leader)?.container?.items.filter((item) => item.id === stack.id);
    expect(remaining).toEqual([]);
    const collected = [latest(leader), latest(guest)]
      .flatMap((view) => view?.backpack.items ?? [])
      .filter((item) => item.itemId === stack.itemId && item.ownerNick === null)
      .reduce((sum, item) => sum + item.quantity, 0);
    expect(collected).toBe(stack.quantity);
  });

  it('refuses false distance, a far container and bad quantities', async () => {
    const { leader, guest } = await startMatch();
    await walkTo(leader, HATCH);
    await waitFor(() => latest(leader)?.container !== null, 'contêiner ao alcance');
    const stack = latest(leader)?.container?.items[0];
    if (!stack) throw new Error('contêiner vazio');

    // The guest is still in the middle of the ship: the server does not take its word.
    transfer(guest, { item: stack.id, from: 'container.1', to: 'backpack', quantity: 1 });
    expect(await refusalOf(guest, 1)).toBe(ErrorCode.NotAtHatch);
    // A container across the sector, named directly.
    transfer(leader, { item: stack.id, from: 'container.2', to: 'cargo', quantity: 1 });
    expect(await refusalOf(leader, 1)).toBe(ErrorCode.ContainerOutOfReach);
    // Negative and excessive quantities.
    transfer(leader, { item: stack.id, from: 'container.1', to: 'cargo', quantity: -5 });
    expect(await refusalOf(leader, 2)).toBe(ErrorCode.InvalidPayload);
    transfer(leader, {
      item: stack.id,
      from: 'container.1',
      to: 'cargo',
      quantity: stack.quantity + 1,
    });
    expect(await refusalOf(leader, 3)).toBe(ErrorCode.InvalidQuantity);
    // Nothing goes back into a container.
    transfer(leader, { item: stack.id, from: 'cargo', to: 'container.1', quantity: 1 });
    expect(await refusalOf(leader, 4)).toBe(ErrorCode.InvalidTransfer);
    expect(latest(leader)?.container?.items[0]).toEqual(stack);

    // A valid move reaches the hold, visible to the whole crew.
    transfer(leader, { item: stack.id, from: 'container.1', to: 'cargo', quantity: 1 });
    await waitFor(() => (latest(guest)?.cargo.items.length ?? 0) === 1, 'carga compartilhada');
    expect(latest(guest)?.cargo.items[0]).toMatchObject({ itemId: stack.itemId, quantity: 1 });
  });

  it('moves nothing before the whole crew is aboard', async () => {
    const pair = await party.readyPair();
    await party.confirm(pair.party);
    const leader = await enter(pair.leader);
    await waitFor(() => latest(leader) !== undefined, 'inventário');
    transfer(leader, { item: 'qualquer', from: 'backpack', to: 'cargo', quantity: 1 });
    expect(await refusalOf(leader, 1)).toBe(ErrorCode.MatchNotActive);
  });
});
