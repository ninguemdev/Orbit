import { describe, expect, it } from 'vitest';
import { CREW, SHIP_HULLS, ShipHullId } from '@orbit/catalog';
import { INPUT_STALE_MS, TICK_RATE_HZ } from '@orbit/contracts';
import { SectorSimulation } from './sector-simulation';

const DT = 1 / TICK_RATE_HZ;
const STEP_DISTANCE = CREW.walkSpeed * DT;

function run(simulation: SectorSimulation, ticks: number, startMs: number): number {
  let now = startMs;
  for (let i = 0; i < ticks; i++) {
    now += DT * 1000;
    simulation.step(DT, now);
  }
  return now;
}

describe('SectorSimulation crew movement', () => {
  it('moves a crew member by at most one step per tick, whatever the message count', () => {
    const simulation = new SectorSimulation();
    const member = simulation.addCrew('a', 'Alfa');
    const start = member.position;
    for (let seq = 0; seq < 50; seq++) simulation.offerCrewInput('a', { seq, x: 1, y: 0 }, 0);
    run(simulation, 1, 0);
    expect(member.position.x - start.x).toBeCloseTo(STEP_DISTANCE);
    expect(member.position.y).toBe(start.y);
    expect(member.lastAppliedSeq).toBe(49);
  });

  it('stops moving when input goes stale', () => {
    const simulation = new SectorSimulation();
    const member = simulation.addCrew('a', 'Alfa');
    simulation.offerCrewInput('a', { seq: 1, x: 0, y: 1 }, 0);
    run(simulation, 20, 0);
    const maxTicks = Math.floor(INPUT_STALE_MS / (DT * 1000)) + 1;
    expect(member.position.y - -30).toBeLessThanOrEqual(maxTicks * STEP_DISTANCE + 1e-6);
  });

  it('keeps the crew inside the hull and out of walls', () => {
    const simulation = new SectorSimulation();
    const member = simulation.addCrew('a', 'Alfa');
    const hull = SHIP_HULLS[ShipHullId.Scout];
    let now = 0;
    for (let seq = 0; seq < 200; seq++) {
      simulation.offerCrewInput('a', { seq, x: 1, y: -1 }, now);
      now = run(simulation, 1, now);
    }
    expect(member.position.y).toBeGreaterThanOrEqual(hull.interiorBounds.minY + CREW.radius - 1e-6);
    expect(member.position.x).toBeLessThanOrEqual(hull.interiorBounds.maxX - CREW.radius + 1e-6);
    for (const wall of hull.interiorWalls) {
      const insideX = member.position.x > wall.minX && member.position.x < wall.maxX;
      const insideY = member.position.y > wall.minY && member.position.y < wall.maxY;
      expect(insideX && insideY).toBe(false);
    }
  });

  it('clears held input on disconnection and refuses replays afterwards', () => {
    const simulation = new SectorSimulation();
    const member = simulation.addCrew('a', 'Alfa');
    simulation.offerCrewInput('a', { seq: 5, x: 1, y: 0 }, 0);
    simulation.setConnected('a', false);
    const before = member.position;
    run(simulation, 3, 0);
    expect(member.position).toEqual(before);
    expect(simulation.offerCrewInput('a', { seq: 5, x: 1, y: 0 }, 100)).toBe('duplicate');
    expect(simulation.offerCrewInput('ghost', { seq: 1, x: 1, y: 0 }, 100)).toBe('unknown_crew');
  });

  it('assigns distinct colors and free spawn points', () => {
    const simulation = new SectorSimulation();
    const a = simulation.addCrew('a', 'Alfa');
    const b = simulation.addCrew('b', 'Bravo');
    expect(a.colorIndex).not.toBe(b.colorIndex);
    expect(a.position).not.toEqual(b.position);
  });
});
