import { describe, expect, it } from 'vitest';
import { resolveCircleRect, distance } from '@orbit/simulation';
import { CREW, SECTORS, SHIP_HULLS } from './index';

describe('catalog consistency', () => {
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
      const radius = SHIP_HULLS['ship.scout'].handling.radius;
      for (const obstacle of sector.obstacles) {
        expect(distance(sector.shipSpawn.position, obstacle)).toBeGreaterThan(
          radius + obstacle.radius,
        );
      }
    });
  }
});
