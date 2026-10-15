import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { CREW } from '@orbit/catalog';
import {
  type ActionRejectedPayload,
  ClientMessage,
  ErrorCode,
  ServerMessage,
  TICK_RATE_HZ,
} from '@orbit/contracts';
import { ABUSE_CLOSE_CODE } from '../src/transport/dev-sector-room';
import {
  type SectorRoom,
  type TestServer,
  crewSnapshot,
  joinDevRoom,
  sleep,
  startTestServer,
  waitFor,
} from './harness';

const STEP = CREW.walkSpeed / TICK_RATE_HZ;

function position(room: SectorRoom, id = room.sessionId) {
  const member = crewSnapshot(room)[id];
  if (!member) throw new Error(`tripulante ${id} ausente`);
  return member;
}

/** Waits until the observer has applied the given tick, so both views can be compared. */
async function sameTick(a: SectorRoom, b: SectorRoom) {
  await sleep(150);
  const tick = Math.max(a.state.tick, b.state.tick);
  await waitFor(() => a.state.tick >= tick && b.state.tick >= tick);
}

describe('crew movement over the network', () => {
  let server: TestServer;
  let rooms: SectorRoom[] = [];

  beforeAll(async () => {
    server = await startTestServer();
  });

  afterEach(async () => {
    await Promise.all(rooms.map((room) => room.leave().catch(() => undefined)));
    rooms = [];
    server.server.simulateLatency(0);
  });

  afterAll(async () => {
    await server.close();
  });

  async function pair(): Promise<[SectorRoom, SectorRoom]> {
    const a = await joinDevRoom(server.endpoint, { name: 'Alfa' });
    const b = await joinDevRoom(server.endpoint, { name: 'Bravo' });
    rooms.push(a, b);
    await waitFor(() => a.state.crew?.size === 2 && b.state.crew?.size === 2);
    return [a, b];
  }

  it('moves a crew member by intent and both clients see the same position', async () => {
    const [a, b] = await pair();
    const start = position(a);
    let seq = 0;
    for (let i = 0; i < 6; i++) {
      a.send(ClientMessage.CrewInput, { seq: seq++, x: 0, y: 1 });
      await sleep(1000 / TICK_RATE_HZ);
    }
    await sleep(400); // input goes stale and the crew member stops
    await sameTick(a, b);
    const end = position(a);
    expect(end.y).toBeGreaterThan(start.y);
    expect(position(b, a.sessionId)).toEqual(end);
    expect(a.state.crew.size).toBe(2);
  });

  it('ignores a client-supplied position and reports the rejection', async () => {
    const [a, b] = await pair();
    const rejections: ActionRejectedPayload[] = [];
    a.onMessage(ServerMessage.ActionRejected, (payload: ActionRejectedPayload) =>
      rejections.push(payload),
    );
    const start = position(a);
    a.send(ClientMessage.CrewInput, { seq: 1, x: 0, y: 0, posX: 999, posY: 999 });
    a.send('crew.teleport', { x: 999, y: 999 });
    await waitFor(() => rejections.length === 2, { label: 'rejeições' });
    await sameTick(a, b);
    expect(position(a)).toEqual(start);
    expect(position(b, a.sessionId)).toEqual(start);
    expect(rejections).toEqual([
      { action: ClientMessage.CrewInput, code: ErrorCode.InvalidPayload },
      { action: 'crew.teleport', code: ErrorCode.InvalidPayload },
    ]);
  });

  it('does not move faster when a client floods inputs', async () => {
    const [a, b] = await pair();
    const startA = position(a);
    const startB = position(b);
    // One input from A; a burst of 40 inputs from B in the same instant.
    a.send(ClientMessage.CrewInput, { seq: 0, x: 1, y: 0 });
    for (let seq = 0; seq < 40; seq++) b.send(ClientMessage.CrewInput, { seq, x: 1, y: 0 });
    await sleep(600);
    await sameTick(a, b);
    const movedA = position(a).x - startA.x;
    const movedB = position(b).x - startB.x;
    expect(movedB).toBeGreaterThan(0);
    // Both inputs live for the same stale window; B gains at most one tick of timing skew.
    expect(Math.abs(movedB - movedA)).toBeLessThanOrEqual(STEP + 1e-3);
  });

  it('disconnects a client that keeps sending invalid messages', async () => {
    const [a] = await pair();
    const closed = new Promise<number>((resolve) => a.onLeave((code) => resolve(code)));
    for (let i = 0; i < 25; i++) a.send(ClientMessage.CrewInput, { seq: -1, x: Number.NaN, y: 0 });
    expect(await closed).toBe(ABUSE_CLOSE_CODE);
    rooms = rooms.filter((room) => room !== a);
  });

  it('keeps clients consistent with 150 ms simulated round-trip', async () => {
    const [a, b] = await pair();
    server.server.simulateLatency(75);
    const start = position(b, a.sessionId);
    for (let seq = 0; seq < 8; seq++) {
      a.send(ClientMessage.CrewInput, { seq, x: -1, y: 0 });
      await sleep(1000 / TICK_RATE_HZ);
    }
    await sleep(700);
    await sameTick(a, b);
    expect(position(b, a.sessionId).x).toBeLessThan(start.x);
    expect(position(b, a.sessionId)).toEqual(position(a));
  });
});
