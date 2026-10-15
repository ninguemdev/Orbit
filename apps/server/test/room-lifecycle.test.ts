import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CATALOG_VERSION } from '@orbit/catalog';
import { PROTOCOL_VERSION, RoomPhase, TICK_RATE_HZ } from '@orbit/contracts';
import {
  type SectorRoom,
  type TestServer,
  crewSnapshot,
  joinDevRoom,
  sleep,
  startTestServer,
  waitFor,
} from './harness';

describe('dev sector room', () => {
  let server: TestServer;
  const rooms: SectorRoom[] = [];

  beforeAll(async () => {
    server = await startTestServer();
  });

  afterAll(async () => {
    await Promise.all(rooms.map((room) => room.leave().catch(() => undefined)));
    await server.close();
  });

  it('puts two clients in the same room with the same authoritative state', async () => {
    const a = await joinDevRoom(server.endpoint, { name: 'Alfa' });
    const b = await joinDevRoom(server.endpoint, { name: 'Bravo' });
    rooms.push(a, b);
    expect(b.roomId).toBe(a.roomId);

    await waitFor(() => a.state.crew?.size === 2 && b.state.crew?.size === 2, {
      label: 'tripulação',
    });
    expect(a.state.protocolVersion).toBe(PROTOCOL_VERSION);
    expect(a.state.catalogVersion).toBe(CATALOG_VERSION);
    expect(a.state.phase).toBe(RoomPhase.Active);

    const tick = a.state.tick;
    await waitFor(() => b.state.tick >= tick, { label: 'mesmo tick' });
    expect(crewSnapshot(a)).toEqual(crewSnapshot(b));
    expect(a.state.ship.hullId).toBe('ship.scout');
    expect({ x: b.state.ship.x, y: b.state.ship.y }).toEqual({
      x: a.state.ship.x,
      y: a.state.ship.y,
    });

    const names: string[] = [];
    a.state.crew.forEach((member) => names.push(member.name));
    expect(names.sort()).toEqual(['Alfa', 'Bravo']);
  });

  it(`advances the server simulation at about ${TICK_RATE_HZ} Hz`, async () => {
    const [room] = rooms;
    if (!room) throw new Error('sala ausente');
    const start = room.state.tick;
    await sleep(1000);
    const elapsed = room.state.tick - start;
    expect(elapsed).toBeGreaterThanOrEqual(TICK_RATE_HZ - 4);
    expect(elapsed).toBeLessThanOrEqual(TICK_RATE_HZ + 4);
  });

  it('refuses a client speaking another protocol version', async () => {
    await expect(
      joinDevRoom(server.endpoint, { protocolVersion: PROTOCOL_VERSION + 1 }),
    ).rejects.toThrow(/protocol_mismatch/);
  });

  it('refuses an origin outside the allow-list', async () => {
    await expect(
      joinDevRoom(server.endpoint, {}, { Origin: 'http://evil.example' }),
    ).rejects.toThrow(/origin_not_allowed/);
  });

  it('removes a member that leaves', async () => {
    const [a, b] = rooms;
    if (!a || !b) throw new Error('salas ausentes');
    const leaving = b.sessionId;
    await b.leave();
    rooms.pop();
    await waitFor(() => a.state.crew.size === 1, { label: 'saída' });
    expect(crewSnapshot(a)[leaving]).toBeUndefined();
  });
});
