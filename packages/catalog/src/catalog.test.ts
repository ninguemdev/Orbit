import { describe, expect, it } from 'vitest';
import { resolveCircleRect, distance } from '@orbit/simulation';
import {
  CLASS_DESCRIPTIONS,
  CLASS_NAMES,
  CLASS_ORDER,
  CREW,
  ClassId,
  SECTORS,
  SHIP_HULLS,
  isClassId,
} from './index';

describe('catalog consistency', () => {
  it('lists every class once, with name and description', () => {
    expect([...CLASS_ORDER].sort()).toEqual(Object.values(ClassId).sort());
    for (const classId of CLASS_ORDER) {
      expect(CLASS_NAMES[classId]).toBeTruthy();
      expect(CLASS_DESCRIPTIONS[classId].role).toBeTruthy();
    }
    expect(isClassId('class.pilot')).toBe(true);
    expect(isClassId('toString')).toBe(false);
  });

  for (const hull of Object.values(SHIP_HULLS)) {
    it(`${hull.id}: spawns and helm seat are walkable`, () => {
      const points = [...hull.crewSpawns, hull.helm.seat];
      for (const point of points) {
        for (const wall of hull.interiorWalls) {
          expect(resolveCircleRect(point, CREW.radius, wall)).toEqual(point);
        }
        expect(point.x - CREW.radius).toBeGreaterThanOrEqual(hull.interiorBounds.minX);
        expect(point.x + CREW.radius).toBeLessThanOrEqual(hull.interiorBounds.maxX);
      }
    });
  }

  for (const hull of Object.values(SHIP_HULLS)) {
    it(`${hull.id}: collision circle encloses the drawn hull`, () => {
      for (const vertex of hull.outline) {
        expect(Math.hypot(vertex.x, vertex.y)).toBeLessThanOrEqual(hull.handling.radius);
      }
    });
  }

  for (const sector of Object.values(SECTORS)) {
    it(`${sector.id}: ship spawn is clear of obstacles`, () => {
      // Any ship may start there: use the largest hull.
      const radius = Math.max(...Object.values(SHIP_HULLS).map((hull) => hull.handling.radius));
      for (const obstacle of sector.obstacles) {
        expect(distance(sector.shipSpawn.position, obstacle)).toBeGreaterThan(
          radius + obstacle.radius,
        );
      }
    });
  }
});
