import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SHIP_HULLS, ShipHullId } from '@orbit/catalog';
import {
  type ActionRejectedPayload,
  ClientMessage,
  ErrorCode,
  ServerMessage,
  TICK_RATE_HZ,
} from '@orbit/contracts';
import { distance, normalize, sub, type Vec2 } from '@orbit/simulation';
import {
  type SectorRoom,
  type TestServer,
  crewSnapshot,
  joinDevRoom,
  safeLeave,
  sleep,
  startTestServer,
  waitFor,
} from './harness';

const HELM = SHIP_HULLS[ShipHullId.Scout].helm;
const FRAME_MS = 1000 / TICK_RATE_HZ;

/** Walks a crew member through waypoints by sending directions only, like a player would. */
async function walk(room: SectorRoom, waypoints: Vec2[], counter: { seq: number }) {
  for (const target of waypoints) {
    const deadline = performance.now() + 5000;
    for (;;) {
      const here = crewSnapshot(room)[room.sessionId];
      if (!here) throw new Error('tripulante ausente');
      if (distance(here, target) < 4) break;
      if (performance.now() > deadline) throw new Error(`não alcançou ${JSON.stringify(target)}`);
      const direction = normalize(sub(target, here));
      room.send(ClientMessage.CrewInput, { seq: counter.seq++, ...direction });
      await sleep(FRAME_MS);
    }
  }
  room.send(ClientMessage.CrewInput, { seq: counter.seq++, x: 0, y: 0 });
  await sleep(FRAME_MS * 3);
}

function rejectionsOf(room: SectorRoom): ActionRejectedPayload[] {
  const list: ActionRejectedPayload[] = [];
  room.onMessage(ServerMessage.ActionRejected, (payload: ActionRejectedPayload) =>
    list.push(payload),
  );
  return list;
}

/** Records the ship position seen by a client at every tick it receives. */
function recordTrajectory(room: SectorRoom): Map<number, string> {
  const trajectory = new Map<number, string>();
  room.onStateChange((state) => {
    trajectory.set(state.tick, `${state.ship.x},${state.ship.y},${state.ship.angle}`);
  });
  return trajectory;
}

describe('piloting the ship with an exclusive helm', () => {
  let server: TestServer;
  let a: SectorRoom;
  let b: SectorRoom;
  const seqA = { seq: 0 };
  const seqB = { seq: 0 };
  let rejectedA: ActionRejectedPayload[];
  let rejectedB: ActionRejectedPayload[];

  beforeAll(async () => {
    server = await startTestServer();
    a = await joinDevRoom(server.endpoint, { name: 'Piloto' });
    b = await joinDevRoom(server.endpoint, { name: 'Segundo' });
    rejectedA = rejectionsOf(a);
    rejectedB = rejectionsOf(b);
    await waitFor(() => a.state.crew?.size === 2 && b.state.crew?.size === 2);
  });

  afterAll(async () => {
    await Promise.all([a, b].map(safeLeave));
    await server.close();
  });

  it('refuses the helm from far away', async () => {
    b.send(ClientMessage.HelmRequest);
    await waitFor(() => rejectedB.length === 1);
    expect(rejectedB[0]).toEqual({
      action: ClientMessage.HelmRequest,
      code: ErrorCode.HelmOutOfRange,
    });
  });

  it('gives the helm to the first crew member who reaches it', async () => {
    await walk(
      a,
      [
        { x: 20, y: 0 },
        { x: HELM.seat.x - 15, y: 0 },
      ],
      seqA,
    );
    a.send(ClientMessage.HelmRequest);
    await waitFor(() => b.state.ship.operatorId === a.sessionId, { label: 'operador' });
    let atHelm = false;
    b.state.crew.forEach((member, id) => {
      if (id === a.sessionId) atHelm = member.atHelm;
    });
    expect(atHelm).toBe(true);

    await walk(
      b,
      [
        { x: 20, y: 0 },
        { x: HELM.seat.x - 20, y: 20 },
      ],
      seqB,
    );
    b.send(ClientMessage.HelmRequest);
    await waitFor(() => rejectedB.length === 2);
    expect(rejectedB[1]).toEqual({
      action: ClientMessage.HelmRequest,
      code: ErrorCode.HelmOccupied,
    });
  });

  it('moves the ship only for the operator, and both clients see the same trajectory', async () => {
    const before = { x: a.state.ship.x, y: a.state.ship.y };
    for (let seq = 0; seq < 10; seq++) {
      b.send(ClientMessage.ShipInput, { seq, thrust: 1, turn: 1 });
      await sleep(FRAME_MS);
    }
    await sleep(300);
    expect({ x: a.state.ship.x, y: a.state.ship.y }).toEqual(before);

    const trajectoryA = recordTrajectory(a);
    const trajectoryB = recordTrajectory(b);
    for (let seq = 0; seq < 30; seq++) {
      a.send(ClientMessage.ShipInput, { seq, thrust: 1, turn: seq < 15 ? 0.6 : -0.6 });
      await sleep(FRAME_MS);
    }
    await sleep(500);
    expect(a.state.ship.x).toBeGreaterThan(before.x);
    const shared = [...trajectoryA.keys()].filter((tick) => trajectoryB.has(tick));
    expect(shared.length).toBeGreaterThan(10);
    for (const tick of shared) expect(trajectoryB.get(tick)).toBe(trajectoryA.get(tick));
    const distinct = new Set(shared.map((tick) => trajectoryA.get(tick)));
    expect(distinct.size).toBeGreaterThan(10);
    expect(rejectedA).toEqual([]);
  });

  it('frees the helm when the operator leaves it, so another member can take it', async () => {
    a.send(ClientMessage.HelmRelease);
    await waitFor(() => b.state.ship.operatorId === '', { label: 'liberação' });
    // Make sure B stands within reach: earlier walks may stop a few pixels off target.
    await walk(b, [{ x: HELM.seat.x - 12, y: 8 }], seqB);
    const refusedBefore = rejectedB.length;
    b.send(ClientMessage.HelmRequest);
    await waitFor(() => a.state.ship.operatorId === b.sessionId, {
      label: () => `novo operador (recusas: ${JSON.stringify(rejectedB.slice(refusedBefore))})`,
    });
  });

  it('frees the helm when the operator disconnects', async () => {
    await b.leave();
    await waitFor(() => a.state.ship.operatorId === '', { label: 'liberação por saída' });
    expect(crewSnapshot(a)[b.sessionId]).toBeUndefined();
  });
});
