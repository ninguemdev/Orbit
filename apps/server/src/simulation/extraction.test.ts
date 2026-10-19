import { describe, expect, it } from 'vitest';
import {
  COLLISION_DAMAGE,
  EXTRACTION,
  SHIP_HULLS,
  ShipHullId,
  type SectorDefinition,
} from '@orbit/catalog';
import { ErrorCode } from '@orbit/contracts';
import { SectorSimulation } from './sector-simulation';

const HULL = SHIP_HULLS[ShipHullId.Scout];
const SEAT = HULL.helm.seat;
const ZONE_CENTER = { x: 1000, y: 0 };
const ZONE_RADIUS = 300;
/** How far the ship's center may stray from the zone center and still fit inside it. */
const ZONE_FIT = ZONE_RADIUS - HULL.handling.radius;

const TEST_SECTOR: SectorDefinition = {
  id: 'sector.test',
  bounds: { minX: -2000, minY: -2000, maxX: 2000, maxY: 2000 },
  obstacles: [{ x: 300, y: 0, radius: 50 }],
  containers: [],
  extractionZones: [{ id: 'extraction.1', ...ZONE_CENTER, radius: ZONE_RADIUS }],
  shipSpawn: { position: { x: 0, y: 0 }, angle: 0 },
};

function missionSimulation(): SectorSimulation {
  return new SectorSimulation(TEST_SECTOR, ShipHullId.Scout, true);
}

function pilot(simulation: SectorSimulation, id = 'a'): void {
  const member = simulation.addCrew(id, id);
  member.position = { x: SEAT.x - 10, y: SEAT.y };
  simulation.requestHelm(id);
}

describe('extraction zone and speed', () => {
  it('counts the ship as inside the zone only once the whole hull fits, and detects its own top speed', () => {
    const simulation = missionSimulation();
    simulation.ship.kinematics = { position: ZONE_CENTER, velocity: { x: 0, y: 0 }, angle: 0 };
    expect(simulation.isInExtractionZone()).toBe(true);
    expect(simulation.isUnderExtractionSpeed()).toBe(true);

    simulation.ship.kinematics = {
      ...simulation.ship.kinematics,
      position: { x: ZONE_CENTER.x + ZONE_FIT + 1, y: 0 },
    };
    expect(simulation.isInExtractionZone()).toBe(false);

    simulation.ship.kinematics = {
      position: ZONE_CENTER,
      velocity: { x: HULL.handling.maxSpeed, y: 0 },
      angle: 0,
    };
    expect(simulation.isInExtractionZone()).toBe(true);
    expect(simulation.isUnderExtractionSpeed()).toBe(false);
  });

  it('never considers a sector without an extraction zone as reachable', () => {
    const noZone: SectorDefinition = { ...TEST_SECTOR, extractionZones: [] };
    const simulation = new SectorSimulation(noZone, ShipHullId.Scout, true);
    expect(simulation.isInExtractionZone()).toBe(false);
  });
});

describe('requestExtraction', () => {
  it('only the helm operator can request it, and only inside the zone under speed', () => {
    const simulation = missionSimulation();
    pilot(simulation, 'a');
    simulation.addCrew('b', 'b');
    simulation.ship.kinematics = { position: { x: 0, y: 0 }, velocity: { x: 0, y: 0 }, angle: 0 };

    expect(simulation.requestExtraction('b', 0)).toEqual({
      ok: false,
      code: ErrorCode.NotHelmOperator,
    });
    expect(simulation.requestExtraction('a', 0)).toEqual({
      ok: false,
      code: ErrorCode.NotInExtractionZone,
    });

    simulation.ship.kinematics = {
      position: ZONE_CENTER,
      velocity: { x: HULL.handling.maxSpeed, y: 0 },
      angle: 0,
    };
    expect(simulation.requestExtraction('a', 0)).toEqual({
      ok: false,
      code: ErrorCode.ExtractionSpeedTooHigh,
    });

    simulation.ship.kinematics = { position: ZONE_CENTER, velocity: { x: 0, y: 0 }, angle: 0 };
    expect(simulation.requestExtraction('a', 1000)).toEqual({ ok: true });
    expect(simulation.evacuation).toEqual({
      counting: true,
      deadlineMs: 1000 + EXTRACTION.evacuationSeconds * 1000,
    });
    // Repeating the request while already counting is a no-op success.
    expect(simulation.requestExtraction('a', 2000)).toEqual({ ok: true });
    expect(simulation.evacuation.deadlineMs).toBe(1000 + EXTRACTION.evacuationSeconds * 1000);
  });
});

describe('mission outcome', () => {
  it('completes the evacuation once the deadline passes, with the match still eligible', () => {
    const simulation = missionSimulation();
    pilot(simulation, 'a');
    simulation.ship.kinematics = { position: ZONE_CENTER, velocity: { x: 0, y: 0 }, angle: 0 };
    expect(simulation.requestExtraction('a', 0)).toEqual({ ok: true });

    simulation.step(1, EXTRACTION.evacuationSeconds * 1000 - 1);
    expect(simulation.outcome).toBe('active');

    simulation.step(1, EXTRACTION.evacuationSeconds * 1000);
    expect(simulation.outcome).toBe('extracted');
    expect(simulation.aboardCrewIds()).toEqual(['a']);
  });

  it('cancels the countdown on leaving the zone or exceeding the speed limit, never finishing it', () => {
    const simulation = missionSimulation();
    pilot(simulation, 'a');
    simulation.ship.kinematics = { position: ZONE_CENTER, velocity: { x: 0, y: 0 }, angle: 0 };
    expect(simulation.requestExtraction('a', 0)).toEqual({ ok: true });

    simulation.ship.kinematics = {
      position: { x: ZONE_CENTER.x + ZONE_FIT + 50, y: 0 },
      velocity: { x: 0, y: 0 },
      angle: 0,
    };
    simulation.step(1, 500);
    expect(simulation.evacuation.counting).toBe(false);

    simulation.step(1, EXTRACTION.evacuationSeconds * 1000 + 1000);
    expect(simulation.outcome).toBe('active');
  });

  it('does not cancel the countdown on ordinary hull damage, only on destruction', () => {
    const simulation = missionSimulation();
    pilot(simulation, 'a');
    simulation.ship.kinematics = { position: ZONE_CENTER, velocity: { x: 0, y: 0 }, angle: 0 };
    expect(simulation.requestExtraction('a', 0)).toEqual({ ok: true });

    simulation.ship.hullPoints = HULL.maxHull - COLLISION_DAMAGE.minImpactSpeed;
    simulation.step(1, 500);
    expect(simulation.evacuation.counting).toBe(true);
    expect(simulation.outcome).toBe('active');
  });

  it('destroys the ship once hull damage from collisions reaches zero', () => {
    const simulation = missionSimulation();
    let now = 0;
    for (let i = 0; i < 5 && simulation.outcome === 'active'; i++) {
      simulation.ship.kinematics = {
        position: { x: 0, y: 0 },
        velocity: { x: 260, y: 0 },
        angle: 0,
      };
      now += 1000;
      simulation.step(1, now);
    }
    expect(simulation.outcome).toBe('destroyed');
    expect(simulation.ship.hullPoints).toBe(0);
  });

  it('loses the mission to the timeout once nobody extracted in time', () => {
    const simulation = missionSimulation();
    simulation.step(1, 0);
    simulation.step(1, EXTRACTION.maxMissionSeconds * 1000);
    expect(simulation.outcome).toBe('timeout');
  });

  it('leaves a sector without mission rules unaffected by hull damage or the timeout', () => {
    const simulation = new SectorSimulation(TEST_SECTOR, ShipHullId.Scout, false);
    simulation.ship.kinematics = { position: { x: 0, y: 0 }, velocity: { x: 260, y: 0 }, angle: 0 };
    simulation.step(1, 0);
    simulation.step(1, EXTRACTION.maxMissionSeconds * 1000);
    expect(simulation.ship.hullPoints).toBe(HULL.maxHull);
    expect(simulation.outcome).toBe('active');
  });
});
