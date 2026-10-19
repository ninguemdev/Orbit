import { describe, expect, it } from 'vitest';
import { resolveCircleRect, distance } from '@orbit/simulation';
import {
  CLASS_DESCRIPTIONS,
  CLASS_NAMES,
  CLASS_ORDER,
  CONTAINER_LOOT,
  CREW,
  ITEMS,
  isItemId,
  ClassId,
  SECTORS,
  SHIP_HULLS,
  isClassId,
  sortByShipOrder,
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
    it(`${hull.id}: spawns, helm seat and cargo hatch are walkable`, () => {
      const points = [...hull.crewSpawns, hull.helm.seat, hull.cargoHatch.position];
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

describe('container loot', () => {
  it('draws only catalog items, each in a single stack', () => {
    expect(CONTAINER_LOOT.stacks.min).toBeGreaterThan(0);
    expect(CONTAINER_LOOT.stacks.max).toBeGreaterThanOrEqual(CONTAINER_LOOT.stacks.min);
    for (const entry of CONTAINER_LOOT.table) {
      expect(isItemId(entry.itemId)).toBe(true);
      expect(entry.weight).toBeGreaterThan(0);
      expect(entry.min).toBeGreaterThan(0);
      expect(entry.max).toBeGreaterThanOrEqual(entry.min);
      expect(entry.max).toBeLessThanOrEqual(ITEMS[entry.itemId].maxStack);
    }
  });
});

describe('ship order', () => {
  it('sorts by catalog order and keeps unknown IDs last', () => {
    const ids = ['ship.unknown', 'ship.hauler', 'ship.scout'];
    expect(sortByShipOrder(ids, (id) => id)).toEqual(['ship.scout', 'ship.hauler', 'ship.unknown']);
  });
});
