import { type Page, expect, test } from '@playwright/test';
import { CREW, EXTRACTION, SHIP_HULLS, ShipHullId } from '@orbit/catalog';
import { closeOpenContexts, signUpInNewContext } from './support/accounts';

test.afterEach(closeOpenContexts);

const HULL = SHIP_HULLS[ShipHullId.Scout];
const SPEED_LIMIT = HULL.handling.maxSpeed * EXTRACTION.maxSpeedFraction;
// findPath's grid cell, and the clearance a cell's center must keep from every obstacle
// beyond the ship's own radius. Both findPath and simplifyPath must use the same value:
// generation (apps/server/src/simulation/sector-generator.ts, OPEN_SECTOR.asteroids)
// only guarantees asteroids.extraGap (200) beyond one ship diameter of the largest hull
// (2*252=504) of surface-to-surface clearance between any two of them — 704 total, so at
// most 352 on each side of the midline. HULL.handling.radius (216) plus this margin must
// stay safely under that, or the search can report no route through a sector the game
// itself guarantees is flyable.
const PATH_CELL = 60;
const PATH_MARGIN = (PATH_CELL * Math.SQRT2) / 2;
// The CI job this runs in (.github/workflows/ci.yml, "Multiplayer com dois navegadores")
// is capped at 38 real minutes, and setup plus the other 11 specs already use about 4 of
// those — a budget the external kill enforces regardless of what Playwright's own
// test.setTimeout says, and without a clean error. So the two missions below, worst case
// (every attempt of both exhausting its own flight deadline), must fit well inside the
// remainder. flyToZone follows a precomputed, collision-free route rather than reacting
// to obstacles turn by turn (see its own doc comment), with real margin built into that
// route for the server's own sweep-based collision check — real but not unlimited slack,
// so this favours giving each attempt real room over having many of them.
const FLIGHT_DEADLINE_MS = 240_000;
// A hostile seed is accepted game variance (see runMission), not a bug, so a failed
// flight retries with a fresh sector; bounded so a run of bad luck still terminates (and
// stays inside the CI job budget above: see FLIGHT_DEADLINE_MS). A route this careful
// still destroyed the ship on CI on rare, late occasions (confirmed from an actual CI
// trace: ~224s into an otherwise clean-looking flight) — real but infrequent enough that
// a third attempt is worth more here than a tighter per-attempt deadline would be.
const MAX_ATTEMPTS = 3;
// Slack per attempt beyond the flight itself: ready-up, confirm, walk to the helm, the
// evacuation wait, and the menu transition. This is a realistic budget for those, not
// walkTo's own absolute worst case (it could in principle run far longer) — a run that
// pathological is already its own, rarer problem, worth a bare Playwright timeout to flag
// as unusual rather than a budget sized only to accommodate it.
const PER_ATTEMPT_OVERHEAD_MS = 45_000;
test.setTimeout(2 * MAX_ATTEMPTS * (FLIGHT_DEADLINE_MS + PER_ATTEMPT_OVERHEAD_MS));

interface ShipState {
  readonly x: number;
  readonly y: number;
  readonly angle: number;
  readonly vx: number;
  readonly vy: number;
  readonly operatorId: string;
  readonly hullPoints: number;
}
interface MissionWorld {
  readonly ship: ShipState;
  readonly crew: Record<string, { readonly x: number; readonly y: number }>;
}
interface Zone {
  readonly x: number;
  readonly y: number;
  readonly radius: number;
}
interface Bounds {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

const world = (page: Page) =>
  page.evaluate(() => window.__orbit?.latest() as MissionWorld | null | undefined);
const layout = (page: Page) =>
  page.evaluate(
    () =>
      window.__orbit?.layout() as
        { bounds: Bounds; extractionZones: Zone[]; asteroids: readonly Zone[] } | null | undefined,
  );
const sessionId = (page: Page) => page.evaluate(() => window.__orbit?.sessionId ?? '');

function wrapAngle(angle: number): number {
  let a = angle;
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

/** Readiness names the revision on screen; a click right after a change may be stale. */
async function ensureReady(page: Page) {
  const notReady = page.getByRole('button', { name: 'Estou pronto' });
  if (!(await notReady.isVisible().catch(() => false))) return;
  await expect(async () => {
    await notReady.click();
    await expect(page.getByRole('button', { name: 'Não estou pronto' })).toBeVisible({
      timeout: 1000,
    });
  }).toPass();
}

/** Waits until two readings of the authoritative position agree: the member stopped. */
async function untilStill(page: Page, id: string) {
  const read = async () => (await world(page))?.crew[id];
  let last = await read();
  const deadline = Date.now() + 2000;
  while (Date.now() < deadline) {
    await page.waitForTimeout(100);
    const now = await read();
    if (!last || !now) return;
    if (Math.hypot(now.x - last.x, now.y - last.y) < 0.5) return;
    last = now;
  }
}

/**
 * Walks the pilot's own crew member to a ship-local target with key pulses (same
 * technique as tests/e2e/mission-loot.spec.ts): holding a key while polling overshoots
 * on a slow CI, so each pulse learns the extra movement of the last one. Waits for the
 * authoritative position to settle before measuring it — on a slow CI the server's
 * stop can land after the key is released, and measuring too early would understate
 * the overshoot and undercorrect the next pulse.
 */
async function walkTo(page: Page, target: { x: number; y: number }, arrivedRadius: number) {
  const id = await sessionId(page);
  await page.locator('canvas').click({ position: { x: 640, y: 30 } });
  let extraMs = 0;
  for (let attempt = 0; attempt < 30; attempt++) {
    const state = await world(page);
    const self = state?.crew[id];
    if (!state || !self) throw new Error('estado ausente');
    const local = { x: target.x - self.x, y: target.y - self.y };
    const distance = Math.hypot(local.x, local.y);
    if (distance < arrivedRadius) return;
    const angle = state.ship.angle;
    const screen = {
      x: (local.x * Math.cos(angle) - local.y * Math.sin(angle)) / distance,
      y: (local.x * Math.sin(angle) + local.y * Math.cos(angle)) / distance,
    };
    const keys: string[] = [];
    if (screen.x > 0.38) keys.push('KeyD');
    if (screen.x < -0.38) keys.push('KeyA');
    if (screen.y > 0.38) keys.push('KeyS');
    if (screen.y < -0.38) keys.push('KeyW');
    const wantedMs = (distance / CREW.walkSpeed) * 1000 * 0.7;
    const holdMs = Math.min(500, Math.max(30, wantedMs - extraMs));
    for (const key of keys) await page.keyboard.down(key);
    await page.waitForTimeout(holdMs);
    for (const key of keys) await page.keyboard.up(key);
    await untilStill(page, id);
    const after = (await world(page))?.crew[id];
    if (!after) throw new Error('estado ausente');
    const movedMs = (Math.hypot(after.x - self.x, after.y - self.y) / CREW.walkSpeed) * 1000;
    if (movedMs > holdMs) extraMs = movedMs - holdMs;
  }
  throw new Error('não chegou ao destino');
}

type Point = { readonly x: number; readonly y: number };

function distanceToSegment(p: Point, a: Point, b: Point): number {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const lenSq = abx * abx + aby * aby;
  if (lenSq === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.y - a.y) * aby) / lenSq));
  return Math.hypot(p.x - (a.x + t * abx), p.y - (a.y + t * aby));
}

/**
 * Grid BFS from `start` to within `goalRadius` of `goal`, keeping a ship of `shipRadius`
 * at least a cell's half-diagonal away from every obstacle — the exact technique the
 * server itself uses to guarantee a mission is only ever offered with a flyable route
 * (apps/server/src/simulation/sector-generator.ts, findRoutes), re-run here for the real
 * ship rather than trusting a straight line, or a reactive potential field, to find one:
 * the latter got stuck in local minima against a dense cluster and sometimes grazed an
 * asteroid outright, worse still under a real browser's slower round-trip per decision.
 */
function findPath(
  bounds: Bounds,
  obstacles: readonly Zone[],
  shipRadius: number,
  start: Point,
  goal: Point,
  goalRadius: number,
): Point[] | null {
  const columns = Math.max(1, Math.floor((bounds.maxX - bounds.minX) / PATH_CELL));
  const rows = Math.max(1, Math.floor((bounds.maxY - bounds.minY) / PATH_CELL));
  const toColumn = (px: number) =>
    Math.min(columns - 1, Math.max(0, Math.floor((px - bounds.minX) / PATH_CELL)));
  const toRow = (py: number) =>
    Math.min(rows - 1, Math.max(0, Math.floor((py - bounds.minY) / PATH_CELL)));
  const center = (cell: number): Point => ({
    x: bounds.minX + ((cell % columns) + 0.5) * PATH_CELL,
    y: bounds.minY + (Math.floor(cell / columns) + 0.5) * PATH_CELL,
  });
  const cellsWithin = (point: Point, radius: number): number[] => {
    const cells: number[] = [];
    for (let row = toRow(point.y - radius); row <= toRow(point.y + radius); row++) {
      for (
        let column = toColumn(point.x - radius);
        column <= toColumn(point.x + radius);
        column++
      ) {
        const cell = row * columns + column;
        if (Math.hypot(center(cell).x - point.x, center(cell).y - point.y) <= radius) {
          cells.push(cell);
        }
      }
    }
    return cells;
  };

  const free = new Uint8Array(columns * rows);
  for (let cell = 0; cell < free.length; cell++) {
    const point = center(cell);
    free[cell] =
      point.x >= bounds.minX + shipRadius &&
      point.x <= bounds.maxX - shipRadius &&
      point.y >= bounds.minY + shipRadius &&
      point.y <= bounds.maxY - shipRadius
        ? 1
        : 0;
  }
  for (const obstacle of obstacles) {
    const reach = obstacle.radius + shipRadius + PATH_MARGIN;
    for (const cell of cellsWithin(obstacle, reach)) {
      if (Math.hypot(center(cell).x - obstacle.x, center(cell).y - obstacle.y) < reach) {
        free[cell] = 0;
      }
    }
  }

  const startCell = toRow(start.y) * columns + toColumn(start.x);
  if (!free[startCell]) return null;
  const parent = new Int32Array(free.length).fill(-1);
  parent[startCell] = startCell;
  const queue = [startCell];
  for (let head = 0; head < queue.length; head++) {
    const cell = queue[head] as number;
    const column = cell % columns;
    const row = Math.floor(cell / columns);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
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

  const target = cellsWithin(goal, goalRadius).find((cell) => parent[cell] !== -1);
  if (target === undefined) return null;
  const cells: number[] = [target];
  for (let cell = target; cell !== startCell; cell = parent[cell] as number) {
    cells.push(parent[cell] as number);
  }
  return [start, ...cells.reverse().map(center)];
}

/**
 * Skips ahead to the farthest waypoint with a clear line of sight, so the ship flies the
 * route's shape, not its every grid cell: a straight run between two cells the search
 * never compared directly needs its own clearance check against each obstacle.
 */
function simplifyPath(
  path: readonly Point[],
  obstacles: readonly Zone[],
  shipRadius: number,
): Point[] {
  // The same margin findPath itself used: a shortcut must never be tighter than the grid
  // route it replaces, or simplifying it away is exactly what erodes the clearance the
  // search was careful to keep.
  const clear = (a: Point, b: Point) =>
    obstacles.every((o) => distanceToSegment(o, a, b) >= o.radius + shipRadius + PATH_MARGIN);
  const result: Point[] = [path[0] as Point];
  let i = 0;
  while (i < path.length - 1) {
    let next = i + 1;
    for (let j = path.length - 1; j > i + 1; j--) {
      if (clear(path[i] as Point, path[j] as Point)) {
        next = j;
        break;
      }
    }
    result.push(path[next] as Point);
    i = next;
  }
  return result;
}

/**
 * Pilots the ship to the extraction zone along a precomputed, collision-free route
 * (findPath/simplifyPath above) instead of reacting turn by turn to nearby asteroids —
 * see findPath for why. Steering only has to not cut a waypoint's corner, not avoid
 * anything, which is a far easier (and more reliable) problem than general avoidance.
 * Returns 'reached' once in the zone under the evacuation speed limit, 'disconnected' if
 * the mission state disappears first (ship destroyed, server-side mission timeout — the
 * real one is 20 minutes, not this function's budget), or 'gave-up' if this function's
 * own patience runs out while the mission is still active, or no route was found at all
 * (should not happen: the server already guarantees one for a ship this size or larger
 * before offering the mission) — the caller must then actively leave, since the server
 * will otherwise keep the mission running.
 */
async function flyToZone(
  page: Page,
  zone: Zone,
  asteroids: readonly Zone[],
  bounds: Bounds,
): Promise<'reached' | 'disconnected' | 'gave-up'> {
  const fitRadius = zone.radius - HULL.handling.radius;
  // Beyond the hull's own radius: the server resolves collision by sweeping the actual
  // move within its tick, not just checking the position after it, so a fast ship can
  // still close a narrow gap between two samples here — this pads the route itself
  // against that, rather than trying to react to it in time once already that close.
  // Kept modest (see PATH_CELL/PATH_MARGIN above): generation only guarantees 352 of
  // this kind of clearance on each side of the midline between two asteroids.
  const shipClearance = HULL.handling.radius + 40;
  const start = (await world(page))?.ship;
  if (!start) return 'disconnected';
  const rawPath = findPath(bounds, asteroids, shipClearance, start, zone, fitRadius * 0.6);
  if (!rawPath) return 'gave-up';
  const waypoints: Point[] = [
    ...simplifyPath(rawPath, asteroids, shipClearance).slice(1),
    { x: zone.x, y: zone.y },
  ];
  // How sharp the turn at each waypoint will be (0 straight through, 1 a full reversal):
  // the route is a sequence of positions, not headings, so nothing stops the ship
  // arriving at one still carrying speed from the leg before it — a sharp turn needs
  // braking well before the waypoint itself, not only once already close to or turning
  // on it, or momentum carries it past the safe corridor the route was built for.
  const points = [start, ...waypoints];
  const turnSeverity = waypoints.map((_, i) => {
    if (i === waypoints.length - 1) return 0;
    const prev = points[i] as Point;
    const cur = points[i + 1] as Point;
    const next = points[i + 2] as Point;
    const inHeading = Math.atan2(cur.y - prev.y, cur.x - prev.x);
    const outHeading = Math.atan2(next.y - cur.y, next.x - cur.x);
    return Math.abs(wrapAngle(outHeading - inHeading)) / Math.PI;
  });

  let thrustKey: 'KeyW' | 'KeyS' | null = null;
  let turnKey: 'KeyA' | 'KeyD' | null = null;
  const setKey = async (key: string, down: boolean) => {
    if (down) await page.keyboard.down(key);
    else await page.keyboard.up(key);
  };
  const release = async () => {
    if (thrustKey) await setKey(thrustKey, false);
    if (turnKey) await setKey(turnKey, false);
    thrustKey = null;
    turnKey = null;
  };

  let waypointIndex = 0;
  const deadline = Date.now() + FLIGHT_DEADLINE_MS;
  // CI has destroyed the ship repeatedly across unrelated steering rewrites and margin
  // sizes that all ran clean locally, so the cause is something this flight loop itself
  // can observe but a local run apparently does not reproduce. This prints to the CI log
  // directly (no artifact download needed) so the next failure's actual flight profile —
  // not another guess — is what drives the next fix.
  let lastHull = Infinity;
  let lastDiagAt = 0;

  try {
    for (;;) {
      if (Date.now() > deadline) return 'gave-up';
      const state = await world(page);
      if (!state) return 'disconnected';
      const { x, y, angle, vx, vy, hullPoints } = state.ship;
      const distanceToZone = Math.hypot(zone.x - x, zone.y - y);
      const speed = Math.hypot(vx, vy);
      // Comfortably inside the zone and nearly stopped, not merely under the limit at
      // this instant: residual velocity otherwise keeps carrying the ship in a straight
      // line and can drift it back out (or over the limit) during the 10s evacuation
      // countdown, which cancels it — see the cancellation handling in runMission.
      if (distanceToZone <= fitRadius * 0.7 && speed <= SPEED_LIMIT * 0.5) {
        return 'reached';
      }

      // Skip any waypoint already close enough, possibly more than one if a turn cut a
      // corner — never step back to one already behind.
      while (
        waypointIndex < waypoints.length - 1 &&
        Math.hypot(
          (waypoints[waypointIndex] as Point).x - x,
          (waypoints[waypointIndex] as Point).y - y,
        ) < 250
      ) {
        waypointIndex++;
      }
      const target = waypoints[waypointIndex] as Point;
      const dx = target.x - x;
      const dy = target.y - y;
      const distanceToTarget = Math.hypot(dx, dy);
      const diff = wrapAngle(Math.atan2(dy, dx) - angle);
      let wantTurn: 1 | -1 | 0 = Math.abs(diff) < 0.08 ? 0 : diff > 0 ? 1 : -1;

      const lastLeg = waypointIndex === waypoints.length - 1;
      const approaching = lastLeg && distanceToZone < fitRadius + 2500;
      const severity = turnSeverity[waypointIndex] as number;
      // How far before the waypoint to start slowing for its turn: only this close, not
      // for the whole leg — cruising a long, straight approach at a sharp turn's speed
      // the entire way there wastes most of the flight's budget for no safety gain.
      const brakingDistance = 300 + severity * 1500;
      const speedCap = Math.min(
        HULL.handling.maxSpeed * 0.85,
        // A sharp turn ahead slows down well before reaching it (see turnSeverity above),
        // not only once already close to or turning on it: cutting it at speed is exactly
        // how the old reactive steering grazed a neighbour while correcting late, and
        // arriving at a waypoint still carrying speed from the leg before it drifts the
        // ship past the corridor the route was built for.
        severity > 0.15 && distanceToTarget < brakingDistance
          ? HULL.handling.maxSpeed * Math.max(0.25, 0.85 - severity)
          : Infinity,
        Math.abs(diff) > 0.6 ? HULL.handling.maxSpeed * 0.5 : Infinity,
        Math.max(80, distanceToTarget - 100),
        approaching ? SPEED_LIMIT * 1.3 : Infinity,
      );
      let wantThrust: 1 | -1 | 0 =
        speed > speedCap ? -1 : speed < speedCap * 0.85 && Math.abs(diff) < 1.2 ? 1 : 0;

      // Last-resort net, independent of the planned route: the route only guarantees
      // ~82 units of hull clearance along it (shipClearance's extra plus PATH_MARGIN
      // above), not that momentum never carries the ship outside that corridor, so this
      // is a genuine emergency threshold, well inside that normal operating clearance,
      // not a routine one — it must never settle for just slowing down once close, which
      // would permanently strand the ship near any ordinary waypoint hugging that same
      // ~82-unit margin: it keeps moving, away from the threat, until actually clear.
      let nearestGap = Infinity;
      let nearestBearing = 0;
      for (const asteroid of asteroids) {
        const adx = asteroid.x - x;
        const ady = asteroid.y - y;
        const adist = Math.hypot(adx, ady);
        const gap = adist - asteroid.radius - HULL.handling.radius;
        if (gap < nearestGap) {
          nearestGap = gap;
          nearestBearing = Math.atan2(ady, adx);
        }
      }
      if (nearestGap < 40) {
        wantThrust = speed < 80 ? 1 : speed > 140 ? -1 : 0;
        const awayDiff = wrapAngle(nearestBearing + Math.PI - angle);
        wantTurn = Math.abs(awayDiff) < 0.1 ? 0 : awayDiff > 0 ? 1 : -1;
      }
      if (hullPoints !== lastHull || Date.now() - lastDiagAt > 2000) {
        lastHull = hullPoints;
        lastDiagAt = Date.now();
        console.log(
          `[flight] hull=${hullPoints.toFixed(1)} wp=${waypointIndex}/${waypoints.length} ` +
            `pos=(${x.toFixed(0)},${y.toFixed(0)}) speed=${speed.toFixed(0)} ` +
            `gap=${nearestGap === Infinity ? 'inf' : nearestGap.toFixed(0)} ` +
            `thrust=${wantThrust} turn=${wantTurn}`,
        );
      }

      const nextTurnKey = wantTurn === 0 ? null : wantTurn > 0 ? 'KeyD' : 'KeyA';
      if (nextTurnKey !== turnKey) {
        if (turnKey) await setKey(turnKey, false);
        if (nextTurnKey) await setKey(nextTurnKey, true);
        turnKey = nextTurnKey;
      }
      const nextThrustKey = wantThrust === 0 ? null : wantThrust > 0 ? 'KeyW' : 'KeyS';
      if (nextThrustKey !== thrustKey) {
        if (thrustKey) await setKey(thrustKey, false);
        if (nextThrustKey) await setKey(nextThrustKey, true);
        thrustKey = nextThrustKey;
      }
      await page.waitForTimeout(100);
    }
  } finally {
    await release();
  }
}

/**
 * Waits out the evacuation countdown. It can still be cancelled server-side (leaving
 * the zone or going over the speed limit before it finishes), which does not end the
 * mission — the HUD just offers "Iniciar evacuação" again — so this polls for either
 * the party returning to the menu (done) or that button reappearing (cancelled).
 */
async function waitForEvacuation(page: Page): Promise<'done' | 'cancelled'> {
  const deadline = Date.now() + (EXTRACTION.evacuationSeconds + 8) * 1000;
  while (Date.now() < deadline) {
    if (
      await page
        .getByTestId('signed-in-as')
        .isVisible()
        .catch(() => false)
    )
      return 'done';
    if (
      await page
        .getByRole('button', { name: 'Iniciar evacuação' })
        .isVisible()
        .catch(() => false)
    ) {
      return 'cancelled';
    }
    await page.waitForTimeout(300);
  }
  return 'cancelled';
}

/**
 * Confirms the preparation, flies to the zone and extracts. A procedurally hostile
 * asteroid field (ship destroyed or flight taking too long) is accepted game variance,
 * not a defect in the extraction/settlement pipeline under test, so a failed flight
 * retries with a freshly seeded sector rather than failing the test outright.
 */
async function runMission(alfa: Page, bravo: Page, alfaNick: string, bravoNick: string) {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    await ensureReady(alfa);
    await ensureReady(bravo);
    await alfa.getByRole('button', { name: 'Confirmar preparação' }).click();
    await Promise.all(
      [alfa, bravo].map(async (page) => {
        await expect(page.getByTestId('game').locator('canvas')).toBeVisible();
        await expect(page.getByTestId('hud')).toContainText(alfaNick);
        await expect(page.getByTestId('hud')).toContainText(bravoNick);
      }),
    );

    let sector: Awaited<ReturnType<typeof layout>>;
    await expect
      .poll(
        async () => {
          sector = await layout(alfa);
          return sector?.extractionZones?.length ?? 0;
        },
        { timeout: 15_000 },
      )
      .toBe(1);
    const zone = sector?.extractionZones[0];
    if (!zone) throw new Error('zona de extração ausente');
    const asteroids = sector?.asteroids ?? [];
    const bounds = sector?.bounds;
    if (!bounds) throw new Error('limites do setor ausentes');

    await walkTo(alfa, HULL.helm.seat, HULL.helm.interactRadius - 10);
    await alfa.keyboard.press('KeyE');
    const alfaId = await sessionId(alfa);
    await expect.poll(() => world(alfa).then((w) => w?.ship.operatorId)).toBe(alfaId);

    const flightOutcome = await flyToZone(alfa, zone, asteroids, bounds);
    // Only a resolved outcome (reached and evacuated, or the mission ending on its own
    // terms) settles for real before MissionRoom#settled lets the room close — the
    // database write is already committed by the time the client is back here. A
    // voluntary leave (gave up, or cancelled mid-evacuation) is a technical abort
    // instead: the room closes the moment the last socket does, via Colyseus'
    // autoDispose, and only then does MissionRoom#onDispose fire that write, as
    // fire-and-forget. Reading mission-result right after a voluntary leave would
    // therefore race its own commit.
    let guaranteedSettled = false;
    if (flightOutcome === 'reached') {
      const extractButton = alfa.getByTestId('request-extraction');
      // The HUD polls server state on its own 200 ms cadence; give it a moment to catch
      // up with the authoritative state this test already observed as ready.
      await expect(extractButton).toBeEnabled({ timeout: 5000 });
      await extractButton.click();
      await expect(alfa.getByTestId('evacuation-countdown')).toBeVisible();
      if ((await waitForEvacuation(alfa)) === 'cancelled') {
        await Promise.all(
          [alfa, bravo].map((page) =>
            page
              .getByRole('button', { name: 'Sair da missão' })
              .click()
              .catch(() => undefined),
          ),
        );
      } else {
        guaranteedSettled = true;
      }
    } else if (flightOutcome === 'gave-up') {
      // The mission is still active server-side (its own timeout is 20 minutes) —
      // leave deliberately so this attempt ends now instead of outlasting the test.
      await Promise.all(
        [alfa, bravo].map((page) =>
          page
            .getByRole('button', { name: 'Sair da missão' })
            .click()
            .catch(() => undefined),
        ),
      );
    }
    // flightOutcome === 'disconnected' falls through with guaranteedSettled left false:
    // it could be a resolved outcome (the ship was destroyed) or a genuinely dropped
    // connection, and the two cannot be told apart from here.

    await Promise.all(
      [alfa, bravo].map((page) =>
        expect(page.getByTestId('signed-in-as')).toBeVisible({ timeout: 30_000 }),
      ),
    );

    const result = alfa.getByTestId('mission-result');
    let resultText = '';
    if (guaranteedSettled) {
      await expect(result).toBeVisible({ timeout: 10_000 });
      resultText = (await result.textContent()) ?? '';
    } else {
      // Not guaranteed to be there yet (see above): wait a little anyway, since it
      // usually already is, but treat it missing as "not extracted" rather than
      // racing the commit for an answer.
      const appeared = await result
        .waitFor({ state: 'visible', timeout: 10_000 })
        .then(() => true)
        .catch(() => false);
      if (appeared) resultText = (await result.textContent()) ?? '';
    }
    const extracted = resultText.includes('Extração concluída.');
    if (extracted) {
      await Promise.all(
        [alfa, bravo].map(async (page) => {
          // Only the success notice reads "A missão terminou." — a technical abort
          // reads "A missão terminou sem extração...", a different sentence entirely.
          await expect(page.getByTestId('party-notice')).toContainText('A missão terminou.');
          const page_result = page.getByTestId('mission-result');
          await expect(page_result).toContainText('Extração concluída.');
          // The stash list itself only renders once it has an item; the inventory panel
          // around it is always present, empty loadouts included.
          await expect(page.getByTestId('inventory')).not.toContainText('(reservado)');
          await expect(page.getByTestId('expedition-preparing')).toHaveCount(0);
          await page_result.getByRole('button', { name: 'Dispensar' }).click();
        }),
      );
      return;
    }
    await Promise.all(
      [alfa, bravo].map((page) =>
        page
          .getByTestId('mission-result')
          .getByRole('button', { name: 'Dispensar' })
          .click()
          .catch(() => undefined),
      ),
    );
    if (attempt === MAX_ATTEMPTS) {
      throw new Error(`a nave não extraiu em ${MAX_ATTEMPTS} tentativas (última: "${resultText}")`);
    }
  }
}

test('two successive missions extract cleanly, with no leftover reservation or duplication', async ({
  browser,
}) => {
  const alfa = await signUpInNewContext(browser, 'Extr_A', '/?debug=1');
  const bravo = await signUpInNewContext(browser, 'Extr_B');
  const code = (await alfa.page.getByTestId('party-code').textContent()) ?? '';
  await bravo.page.getByLabel('Entrar em outra party (código)').fill(code);
  await bravo.page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(alfa.page.getByRole('heading', { name: /Sua party \(2\/4\)/ })).toBeVisible();
  for (const [page, name] of [
    [alfa.page, 'Piloto'],
    [bravo.page, 'Engenheiro'],
  ] as const) {
    const radio = page.getByRole('radio', { name: new RegExp(`^${name}`) });
    await radio.click();
    await expect(radio).toBeChecked();
  }

  await test.step('first mission: extracts for real, nothing stuck in the stash', async () => {
    await runMission(alfa.page, bravo.page, alfa.nick, bravo.nick);
  });

  await test.step('second mission with the same party: starts and extracts again, no duplication', async () => {
    await runMission(alfa.page, bravo.page, alfa.nick, bravo.nick);
  });
});
