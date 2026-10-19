import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  CONTAINER_LOOT,
  LARGEST_SHIP_RADIUS,
  OPEN_SECTOR,
  type SectorDefinition,
  SectorId,
  sectorSolids,
} from '@orbit/catalog';
import { type Circle, type Vec2, distance, sub, sweepCircle } from '@orbit/simulation';
import {
  findRoutes,
  generateContainerLoot,
  generateOpenSector,
  newSectorSeed,
  seededRandom,
} from './sector-generator';

const APPROACH = OPEN_SECTOR.containers.approachDistance;

/** Reproducible seeds: the same list on every run. */
const SEEDS = Array.from({ length: 150 }, (_, index) =>
  createHash('sha256').update(`teste-setor-${index}`).digest('hex'),
);

/** Flies the route with the ship's own collision: no segment may touch anything. */
function expectFlyable(route: readonly Vec2[], sector: SectorDefinition) {
  const radius = LARGEST_SHIP_RADIUS;
  const { bounds } = sector;
  for (let index = 1; index < route.length; index++) {
    const from = route[index - 1] as Vec2;
    const to = route[index] as Vec2;
    expect(sweepCircle(from, sub(to, from), radius, sectorSolids(sector))).toBeNull();
    expect(to.x - radius).toBeGreaterThanOrEqual(bounds.minX);
    expect(to.x + radius).toBeLessThanOrEqual(bounds.maxX);
    expect(to.y - radius).toBeGreaterThanOrEqual(bounds.minY);
    expect(to.y + radius).toBeLessThanOrEqual(bounds.maxY);
  }
}

describe('open sector generation', () => {
  it('gives the same sector for the same seed and different sectors for different seeds', () => {
    const [first, second] = SEEDS as [string, string];
    expect(generateOpenSector(first)).toEqual(generateOpenSector(first));
    expect(generateOpenSector(first)).not.toEqual(generateOpenSector(second));
  });

  it('refuses malformed seeds', () => {
    expect(() => generateOpenSector('1234')).toThrow();
    expect(() => generateOpenSector('Z'.repeat(64))).toThrow();
    expect(newSectorSeed()).toMatch(/^[0-9a-f]{64}$/);
  });

  it('derives independent streams for layout and hidden contents', () => {
    const seed = SEEDS[0] as string;
    const layout = seededRandom(seed, 'layout.0');
    const loot = seededRandom(seed, 'loot');
    const layoutValues = Array.from({ length: 8 }, layout);
    expect(Array.from({ length: 8 }, loot)).not.toEqual(layoutValues);
    expect(Array.from({ length: 8 }, seededRandom(seed, 'layout.0'))).toEqual(layoutValues);
    for (const value of layoutValues) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it.each(SEEDS.map((seed, index) => [index, seed] as const))(
    'seed %i: finite sector, safe spawn and a flyable route to every container and the exit',
    (_index, seed) => {
      const sector = generateOpenSector(seed);
      const { halfSize, safeRadius } = OPEN_SECTOR;
      expect(sector.id).toBe(SectorId.Open);
      expect(sector.bounds).toEqual({
        minX: -halfSize,
        minY: -halfSize,
        maxX: halfSize,
        maxY: halfSize,
      });
      expect(sector.obstacles.length).toBeGreaterThan(OPEN_SECTOR.asteroids.count / 2);
      expect(sector.containers).toHaveLength(OPEN_SECTOR.containers.count);
      expect(sector.extractionZones).toHaveLength(1);

      const spawn = sector.shipSpawn.position;
      for (const solid of sectorSolids(sector)) {
        expect(distance(spawn, solid) - solid.radius).toBeGreaterThanOrEqual(safeRadius - 1e-6);
      }
      for (const solid of sectorSolids(sector)) {
        expect(solid.x - solid.radius).toBeGreaterThanOrEqual(-halfSize);
        expect(solid.x + solid.radius).toBeLessThanOrEqual(halfSize);
        expect(solid.y - solid.radius).toBeGreaterThanOrEqual(-halfSize);
        expect(solid.y + solid.radius).toBeLessThanOrEqual(halfSize);
      }
      const zone = sector.extractionZones[0];
      if (!zone) throw new Error('sem zona de extração');
      // The exit is never at the spawn, and no asteroid sits inside it.
      expect(distance(spawn, zone)).toBeGreaterThan(OPEN_SECTOR.spawnDistance);
      for (const asteroid of sector.obstacles) {
        expect(distance(asteroid, zone)).toBeGreaterThan(asteroid.radius + zone.radius);
      }

      const routes = findRoutes(sector, LARGEST_SHIP_RADIUS, APPROACH);
      const [exit] = routes.extractionZones;
      if (!exit) throw new Error('sem rota para a extração');
      expectFlyable(exit, sector);
      expect(distance(exit.at(-1) as Vec2, zone)).toBeLessThanOrEqual(zone.radius);
      routes.containers.forEach((route, index) => {
        const container = sector.containers[index];
        if (!route || !container) throw new Error(`sem rota para o contêiner ${index + 1}`);
        expectFlyable(route, sector);
        const end = route.at(-1) as Vec2;
        expect(
          distance(end, container) - container.radius - LARGEST_SHIP_RADIUS,
        ).toBeLessThanOrEqual(APPROACH);
      });
    },
  );

  it('fills every container from the seed, within the loot table', () => {
    for (const seed of SEEDS.slice(0, 40)) {
      const sector = generateOpenSector(seed);
      const loot = generateContainerLoot(seed, sector.containers);
      expect(generateContainerLoot(seed, sector.containers)).toEqual(loot);
      expect([...loot.keys()]).toEqual(sector.containers.map((container) => container.id));
      for (const contents of loot.values()) {
        expect(contents.length).toBeGreaterThanOrEqual(CONTAINER_LOOT.stacks.min);
        expect(contents.length).toBeLessThanOrEqual(CONTAINER_LOOT.stacks.max);
        for (const stack of contents) {
          const entry = CONTAINER_LOOT.table.find((candidate) => candidate.itemId === stack.itemId);
          if (!entry) throw new Error(`item fora da tabela: ${stack.itemId}`);
          expect(Number.isInteger(stack.quantity)).toBe(true);
          expect(stack.quantity).toBeGreaterThanOrEqual(entry.min);
          expect(stack.quantity).toBeLessThanOrEqual(entry.max);
        }
      }
    }
    // Different seeds give different contents.
    const [first, second] = SEEDS as [string, string];
    const containers = generateOpenSector(first).containers;
    expect(generateContainerLoot(first, containers)).not.toEqual(
      generateContainerLoot(second, containers),
    );
  });

  it('finds no route when asteroids close the spawn in', () => {
    // A ring of touching asteroids around the spawn.
    const ring: Circle[] = Array.from({ length: 24 }, (_, index) => {
      const angle = (index / 24) * Math.PI * 2;
      return { x: Math.cos(angle) * 1500, y: Math.sin(angle) * 1500, radius: 220 };
    });
    const sector: SectorDefinition = {
      id: SectorId.Open,
      bounds: { minX: -6000, minY: -6000, maxX: 6000, maxY: 6000 },
      obstacles: ring,
      containers: [{ id: 'container.1', x: 4000, y: 0, radius: 36 }],
      extractionZones: [
        { id: 'extraction.1', x: -4000, y: 0, radius: 600 },
        // Inside the ring: reachable even while the other exit is not.
        { id: 'extraction.2', x: 600, y: 0, radius: 200 },
      ],
      shipSpawn: { position: { x: 0, y: 0 }, angle: 0 },
    };
    const routes = findRoutes(sector, LARGEST_SHIP_RADIUS, APPROACH);
    expect(routes.extractionZones[0]).toBeNull();
    expect(routes.extractionZones[1]).not.toBeNull();
    expect(routes.containers).toEqual([null]);

    // One gap wide enough for the ship opens both routes.
    const opened = { ...sector, obstacles: ring.filter((_, index) => index !== 0 && index !== 1) };
    const openRoutes = findRoutes(opened, LARGEST_SHIP_RADIUS, APPROACH);
    expect(openRoutes.extractionZones[0]).not.toBeNull();
    expect(openRoutes.containers[0]).not.toBeNull();
  });
});
