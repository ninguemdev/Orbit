import { createHash, randomBytes } from 'node:crypto';
import {
  LARGEST_SHIP_RADIUS,
  OPEN_SECTOR,
  type SectorDefinition,
  type SectorFeature,
  SectorId,
} from '@orbit/catalog';
import { type Circle, type Vec2, distance, fromAngle, wrapAngle } from '@orbit/simulation';

/**
 * Private seed of one mission: 256 bits as 64 hex characters. It never leaves the
 * server. Layout and hidden contents use separate streams derived from it, so even
 * someone who reconstructs the visible layout learns nothing about what is hidden.
 */
export type SectorSeed = string;

const SEED_PATTERN = /^[0-9a-f]{64}$/;
/** Layout attempts before giving up; a valid layout is the norm on the first one. */
const MAX_ATTEMPTS = 8;
const PLACEMENT_TRIES = 200;
const ASTEROID_TRIES = 40;
/** Grid of the route check. Smaller is more precise and slower. */
const ROUTE_CELL = 50;

export function newSectorSeed(): SectorSeed {
  return randomBytes(32).toString('hex');
}

/**
 * Deterministic random numbers in [0, 1) for one named stream of a seed. Each stream
 * is seeded by SHA-256 of its name and the seed, so streams are independent.
 */
export function seededRandom(seed: SectorSeed, stream: string): () => number {
  if (!SEED_PATTERN.test(seed)) throw new Error('Seed de setor inválida');
  const digest = createHash('sha256').update(`orbit.sector.${stream}:${seed}`).digest();
  return sfc32(
    digest.readUInt32LE(0),
    digest.readUInt32LE(4),
    digest.readUInt32LE(8),
    digest.readUInt32LE(12),
  );
}

/** Small fast generator with 128 bits of state (Chris Doty-Humphrey's SFC32). */
function sfc32(a: number, b: number, c: number, d: number): () => number {
  return () => {
    const t = (((a + b) | 0) + d) | 0;
    d = (d + 1) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };
}

/**
 * Builds the open sector of a mission from its seed: square bounds, a safe spawn,
 * asteroids, loot containers and an extraction zone. Every layout is checked for a
 * route from the spawn to each container and to the extraction zone wide enough for
 * the largest ship; the same seed always gives the same sector.
 */
export function generateOpenSector(seed: SectorSeed): SectorDefinition {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const sector = layOut(seededRandom(seed, `layout.${attempt}`));
    if (!sector) continue;
    const routes = findRoutes(sector, LARGEST_SHIP_RADIUS);
    if (routes.extraction && routes.containers.every((route) => route !== null)) return sector;
  }
  throw new Error('Não foi possível gerar um setor com rota');
}

function layOut(random: () => number): SectorDefinition | null {
  const { halfSize, spawnDistance, safeRadius, extraction, containers, asteroids } = OPEN_SECTOR;
  const shipDiameter = LARGEST_SHIP_RADIUS * 2;
  const gap = shipDiameter + asteroids.extraGap;
  const between = (min: number, max: number) => min + (max - min) * random();

  const spawnAngle = random() * Math.PI * 2;
  const spawn = fromAngle(spawnAngle, spawnDistance);
  const zoneCenter = fromAngle(
    spawnAngle + Math.PI + between(-extraction.spread, extraction.spread),
    extraction.distance,
  );
  const zone: SectorFeature = { id: 'extraction.1', ...zoneCenter, radius: extraction.radius };

  const placedContainers: SectorFeature[] = [];
  const containerGap = Math.max(containers.clearance, gap);
  const containerMargin = containers.radius + containerGap;
  for (let index = 0; index < containers.count; index++) {
    let placed: SectorFeature | null = null;
    for (let tries = 0; tries < PLACEMENT_TRIES && !placed; tries++) {
      const point = {
        x: between(-halfSize + containerMargin, halfSize - containerMargin),
        y: between(-halfSize + containerMargin, halfSize - containerMargin),
      };
      if (distance(point, spawn) < containers.minSpawnDistance) continue;
      if (distance(point, zone) < containers.minExtractionDistance) continue;
      if (placedContainers.some((other) => distance(point, other) < containers.minSpacing)) {
        continue;
      }
      placed = { id: `container.${index + 1}`, ...point, radius: containers.radius };
    }
    if (!placed) return null;
    placedContainers.push(placed);
  }

  const obstacles: Circle[] = [];
  for (let index = 0; index < asteroids.count; index++) {
    for (let tries = 0; tries < ASTEROID_TRIES; tries++) {
      // Squared: many small asteroids, few large ones.
      const radius =
        asteroids.minRadius + (asteroids.maxRadius - asteroids.minRadius) * random() ** 2;
      const margin = radius + gap;
      const candidate: Circle = {
        x: between(-halfSize + margin, halfSize - margin),
        y: between(-halfSize + margin, halfSize - margin),
        radius,
      };
      const clear =
        distance(candidate, spawn) >= safeRadius + radius &&
        distance(candidate, zone) >= zone.radius + gap + radius &&
        placedContainers.every(
          (container) => distance(candidate, container) >= container.radius + containerGap + radius,
        ) &&
        obstacles.every((other) => distance(candidate, other) >= other.radius + gap + radius);
      if (clear) {
        obstacles.push(candidate);
        break;
      }
    }
  }

  return {
    id: SectorId.Open,
    bounds: { minX: -halfSize, minY: -halfSize, maxX: halfSize, maxY: halfSize },
    obstacles,
    containers: placedContainers,
    extractionZones: [zone],
    // Facing the center of the sector.
    shipSpawn: { position: spawn, angle: wrapAngle(spawnAngle + Math.PI) },
  };
}

export interface SectorRoutes {
  /** Waypoints from the spawn into the extraction zone, or null without a route. */
  readonly extraction: readonly Vec2[] | null;
  /** Per container, waypoints from the spawn to alongside it, or null. */
  readonly containers: readonly (readonly Vec2[] | null)[];
}

/**
 * Searches routes for a ship of `shipRadius` on a grid. A cell counts as free only
 * when its center keeps the ship half a cell diagonal away from every solid and inside
 * the bounds, so the straight segment between two neighbouring free cells is free too:
 * a route found here can be flown without touching anything.
 */
export function findRoutes(sector: SectorDefinition, shipRadius: number): SectorRoutes {
  const { bounds } = sector;
  const solids: readonly Circle[] = [...sector.obstacles, ...sector.containers];
  const margin = (ROUTE_CELL * Math.SQRT2) / 2;
  const columns = Math.floor((bounds.maxX - bounds.minX) / ROUTE_CELL);
  const rows = Math.floor((bounds.maxY - bounds.minY) / ROUTE_CELL);
  const center = (cell: number): Vec2 => ({
    x: bounds.minX + ((cell % columns) + 0.5) * ROUTE_CELL,
    y: bounds.minY + (Math.floor(cell / columns) + 0.5) * ROUTE_CELL,
  });
  const cellAt = (point: Vec2): number =>
    Math.min(rows - 1, Math.max(0, Math.floor((point.y - bounds.minY) / ROUTE_CELL))) * columns +
    Math.min(columns - 1, Math.max(0, Math.floor((point.x - bounds.minX) / ROUTE_CELL)));

  const free = new Uint8Array(columns * rows);
  for (let cell = 0; cell < free.length; cell++) {
    const point = center(cell);
    const inside =
      point.x >= bounds.minX + shipRadius &&
      point.x <= bounds.maxX - shipRadius &&
      point.y >= bounds.minY + shipRadius &&
      point.y <= bounds.maxY - shipRadius;
    free[cell] = inside ? 1 : 0;
  }
  // Each solid blocks the cells around it; only its bounding box needs checking.
  for (const solid of solids) {
    const reach = solid.radius + shipRadius + margin;
    const toColumn = (x: number) => Math.floor((x - bounds.minX) / ROUTE_CELL);
    const toRow = (y: number) => Math.floor((y - bounds.minY) / ROUTE_CELL);
    const firstRow = Math.max(0, toRow(solid.y - reach));
    const lastRow = Math.min(rows - 1, toRow(solid.y + reach));
    const firstColumn = Math.max(0, toColumn(solid.x - reach));
    const lastColumn = Math.min(columns - 1, toColumn(solid.x + reach));
    for (let row = firstRow; row <= lastRow; row++) {
      for (let column = firstColumn; column <= lastColumn; column++) {
        const cell = row * columns + column;
        if (free[cell] && distance(center(cell), solid) < reach) free[cell] = 0;
      }
    }
  }

  // Breadth-first search from the spawn over the 8 neighbours of each cell.
  const spawn = sector.shipSpawn.position;
  const start = cellAt(spawn);
  const parent = new Int32Array(free.length).fill(-1);
  if (free[start]) {
    parent[start] = start;
    const queue = [start];
    for (let head = 0; head < queue.length; head++) {
      const cell = queue[head] as number;
      const column = cell % columns;
      const row = Math.floor(cell / columns);
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nextColumn = column + dx;
          const nextRow = row + dy;
          if (nextColumn < 0 || nextColumn >= columns || nextRow < 0 || nextRow >= rows) continue;
          const next = nextRow * columns + nextColumn;
          if (!free[next] || parent[next] !== -1) continue;
          parent[next] = cell;
          queue.push(next);
        }
      }
    }
  }

  const routeTo = (target: number): Vec2[] => {
    const cells = [target];
    for (let cell = target; cell !== start; cell = parent[cell] as number) {
      cells.push(parent[cell] as number);
    }
    return [spawn, ...cells.reverse().map(center)];
  };
  const firstReached = (accept: (point: Vec2) => boolean): Vec2[] | null => {
    for (let cell = 0; cell < free.length; cell++) {
      if (parent[cell] !== -1 && accept(center(cell))) return routeTo(cell);
    }
    return null;
  };

  const zone = sector.extractionZones[0];
  const { approachDistance } = OPEN_SECTOR.containers;
  return {
    extraction: zone ? firstReached((point) => distance(point, zone) <= zone.radius) : null,
    containers: sector.containers.map((container) =>
      firstReached(
        (point) => distance(point, container) - container.radius - shipRadius <= approachDistance,
      ),
    ),
  };
}
