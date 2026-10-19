import { describe, expect, it } from 'vitest';
import { SnapshotBuffer } from './snapshot-buffer';
import type { WorldSnapshot } from './world-snapshot';

function snapshot(tick: number, receivedAt: number, x: number, angle = 0): WorldSnapshot {
  return {
    tick,
    receivedAt,
    phase: 'ACTIVE',
    ship: {
      hullId: 'ship.scout',
      x,
      y: 0,
      angle,
      vx: 0,
      vy: 0,
      operatorId: '',
      hullPoints: 100,
      maxHullPoints: 100,
    },
    crew: new Map([
      ['a', { id: 'a', name: 'Alfa', colorIndex: 0, x, y: 0, atHelm: false, connected: true }],
    ]),
    missionOutcome: 'active',
    evacuationCounting: false,
    evacuationSecondsLeft: 0,
  };
}

describe('SnapshotBuffer', () => {
  it('interpolates ship and crew between the snapshots around the render time', () => {
    const buffer = new SnapshotBuffer();
    buffer.push(snapshot(1, 1000, 0));
    buffer.push(snapshot(2, 1050, 10));
    const sampled = buffer.sample(1025);
    expect(sampled?.ship.x).toBeCloseTo(5);
    expect(sampled?.crew.get('a')?.x).toBeCloseTo(5);
  });

  it('interpolates rotation along the shortest arc', () => {
    const buffer = new SnapshotBuffer();
    buffer.push(snapshot(1, 0, 0, Math.PI - 0.1));
    buffer.push(snapshot(2, 100, 0, -Math.PI + 0.1));
    expect(Math.abs(buffer.sample(50)?.ship.angle ?? 0)).toBeCloseTo(Math.PI);
  });

  it('holds the newest state instead of extrapolating, and ignores late duplicates', () => {
    const buffer = new SnapshotBuffer();
    buffer.push(snapshot(5, 1000, 50));
    buffer.push(snapshot(4, 1010, 40));
    expect(buffer.sample(5000)?.ship.x).toBe(50);
    expect(buffer.sample(0)?.ship.x).toBe(50);
  });
});
