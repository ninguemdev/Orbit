import { describe, expect, it } from 'vitest';
import { SHIP_HULLS, ShipHullId } from '@orbit/catalog';
import { ErrorCode, TICK_RATE_HZ } from '@orbit/contracts';
import { SectorSimulation } from './sector-simulation';

const DT = 1 / TICK_RATE_HZ;
const SEAT = SHIP_HULLS[ShipHullId.Scout].helm.seat;

function crewNearHelm(simulation: SectorSimulation, id: string, offsetY = 0) {
  const member = simulation.addCrew(id, id);
  member.position = { x: SEAT.x - 10, y: SEAT.y + offsetY };
  return member;
}

describe('helm', () => {
  it('is exclusive and requires standing near the seat', () => {
    const simulation = new SectorSimulation();
    crewNearHelm(simulation, 'a');
    crewNearHelm(simulation, 'b', 15);
    const far = simulation.addCrew('c', 'c');

    expect(simulation.requestHelm('c')).toEqual({ ok: false, code: ErrorCode.HelmOutOfRange });
    expect(far.atHelm).toBe(false);
    expect(simulation.requestHelm('a')).toEqual({ ok: true });
    expect(simulation.requestHelm('a')).toEqual({ ok: true });
    expect(simulation.requestHelm('b')).toEqual({ ok: false, code: ErrorCode.HelmOccupied });
    expect(simulation.ship.operatorId).toBe('a');
  });

  it('applies ship input only from the operator', () => {
    const simulation = new SectorSimulation();
    crewNearHelm(simulation, 'a');
    crewNearHelm(simulation, 'b', 15);
    expect(simulation.offerShipInput('b', { seq: 0, thrust: 1, turn: 0 }, 0)).toBe('not_operator');
    simulation.step(DT, 0);
    expect(simulation.ship.kinematics.velocity).toEqual({ x: 0, y: 0 });

    simulation.requestHelm('a');
    expect(simulation.offerShipInput('a', { seq: 0, thrust: 1, turn: 0.5 }, 0)).toBe('accepted');
    simulation.step(DT, 10);
    expect(simulation.ship.kinematics.velocity.x).toBeGreaterThan(0);
    expect(simulation.ship.kinematics.angle).toBeGreaterThan(0);
  });

  it('keeps the operator seated and frees the helm on release, drop or leave', () => {
    const simulation = new SectorSimulation();
    const a = crewNearHelm(simulation, 'a');
    crewNearHelm(simulation, 'b', 15);
    simulation.requestHelm('a');
    simulation.offerCrewInput('a', { seq: 0, x: -1, y: 0 }, 0);
    simulation.step(DT, 0);
    expect(a.position).toEqual(SEAT);

    expect(simulation.releaseHelm('b')).toEqual({ ok: false, code: ErrorCode.NotHelmOperator });
    expect(simulation.releaseHelm('a')).toEqual({ ok: true });
    expect(simulation.ship.operatorId).toBeNull();
    expect(a.atHelm).toBe(false);

    expect(simulation.requestHelm('b')).toEqual({ ok: true });
    simulation.setConnected('b', false);
    expect(simulation.ship.operatorId).toBeNull();

    simulation.requestHelm('a');
    simulation.removeCrew('a');
    expect(simulation.ship.operatorId).toBeNull();
  });

  it('lets the ship coast to neutral when the operator input goes stale', () => {
    const simulation = new SectorSimulation();
    crewNearHelm(simulation, 'a');
    simulation.requestHelm('a');
    simulation.offerShipInput('a', { seq: 0, thrust: 1, turn: 1 }, 0);
    let now = 0;
    for (let i = 0; i < 40; i++) simulation.step(DT, (now += 50));
    const angleAfter = simulation.ship.kinematics.angle;
    simulation.step(DT, now + 50);
    expect(simulation.ship.kinematics.angle).toBe(angleAfter);
  });

  it('a new operator starts a fresh input sequence', () => {
    const simulation = new SectorSimulation();
    crewNearHelm(simulation, 'a');
    crewNearHelm(simulation, 'b', 15);
    simulation.requestHelm('a');
    simulation.offerShipInput('a', { seq: 150, thrust: 1, turn: 0 }, 0);
    simulation.releaseHelm('a');
    simulation.requestHelm('b');
    expect(simulation.offerShipInput('b', { seq: 0, thrust: 1, turn: 0 }, 0)).toBe('accepted');
  });
});
