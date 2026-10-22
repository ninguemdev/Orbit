import { TICK_RATE_HZ } from '../../../packages/contracts/src/protocol';
import type { Circle, Rect } from '../../../packages/simulation/src/collision';
import {
  type SectorGeometry,
  type ShipControl,
  type ShipHandling,
  type ShipKinematics,
  stepShip,
} from '../../../packages/simulation/src/ship-movement';
import { wrapAngle } from '../../../packages/simulation/src/vec2';

/**
 * Keyboard autopilot for the E2E flight to an extraction zone: decides W/S/A/D from the
 * authoritative ship state a player sees, using the game's own handling model
 * (`stepShip`) to look ahead. What it has to get right, learned from real CI flight logs:
 *
 * - Thrust, forward or reverse, always pushes along the ship's facing, never against its
 *   velocity. Once the two diverge — turning while carrying momentum — holding "S" can
 *   fail to brake at all or even speed the ship up. Every correction here, braking
 *   included, first aims the thrust axis along the velocity change it needs.
 * - On a slow CI page each decision lands hundreds of milliseconds after the state it
 *   was based on, and the next one lands just as late. Decisions are planned from where
 *   the ship will be when they take effect (the delay is measured from the ship's own
 *   response), and turns and burns are timed pulses instead of holds that last until the
 *   next poll: at 1.6 rad/s, one slow poll is a quarter turn.
 * - Containers are as solid as asteroids: hull damage far from any asteroid was hitting
 *   one of them.
 * - A route's clearance only holds on the route itself: the ship follows the polyline
 *   instead of cutting towards the next waypoint, slows down before each corner, and a
 *   safety check rejects any decision that could no longer be braked to a stop short of
 *   every solid.
 */

const STEP_SECONDS = 1 / TICK_RATE_HZ;
const STEP_MS = 1000 / TICK_RATE_HZ;

/** Route search grid. */
const CELL = 60;
/** A straight move between two neighbouring cells strays at most this far from both centers. */
const HALF_DIAGONAL = (CELL * Math.SQRT2) / 2;
/**
 * Free space around the hull the route keeps at every cell center, at the very least.
 * Generation guarantees 704 between any two solids (OPEN_SECTOR in @orbit/catalog), so
 * the narrowest passage leaves a hull of 216 only 136 on each side of its midline: this
 * must stay well under that or the search finds no route where the game guarantees one.
 */
const MIN_CLEARANCE = 82;
/** Clearance the route prefers wherever the sector has room for it. */
const PREFERRED_CLEARANCE = 420;
/** How much longer a route may get to keep its preferred clearance. */
const CLEARANCE_COST = 3;

/** Highest speed the autopilot plans for, on a long straight leg. */
const CRUISE_SPEED = 150;
/** Deceleration the speed plan counts on; reverse thrust alone is 90 when aligned. */
const PLANNED_BRAKING = 55;
/** Speed through a corner turning by `a` radians: CORNER_SPEED / sin(a), within limits. */
const CORNER_SPEED = 38;
const SLOWEST_CORNER = 28;
/** Pulls the ship back onto the route: lateral speed per unit of cross-track error. */
const LATERAL_GAIN = 0.6;
/** Within this distance of a corner the next leg takes over, if it is the closer one. */
const CORNER_REACH = 120;
/** The last leg ends in a stop this close to the goal. */
const STOP_RADIUS = 40;
/** Velocity error small enough to coast instead of firing. */
const SPEED_TOLERANCE = 10;
/** Thrust only fires with its axis within this angle of the velocity change it is for. */
const ALIGNED = 0.3;
/**
 * Turns shorter than this are left for later: the page only reads the keyboard once per
 * frame, so on a slow page a shorter tap either vanishes or lasts a whole frame anyway.
 */
const SHORTEST_PULSE_MS = 50;

/** Safety check: how far ahead it looks, and the least gap to any solid it accepts. */
const SAFETY_HORIZON_MS = 5000;
const SAFE_GAP = 18;

/** Delay between sending a key and the server applying it, until measured otherwise. */
const INITIAL_DELAY_MS = 200;
const DELAY_CANDIDATES_MS = Array.from({ length: 61 }, (_, i) => i * 25);
/** Readings used to measure the delay. */
const DELAY_WINDOW = 40;

export interface Point {
  readonly x: number;
  readonly y: number;
}

export type Axis = -1 | 0 | 1;

/** The authoritative ship state at one server tick, as the page last received it. */
export interface ShipReading {
  readonly tick: number;
  readonly x: number;
  readonly y: number;
  readonly angle: number;
  readonly vx: number;
  readonly vy: number;
}

/**
 * Keys to hold from the moment this decision is applied: each axis for at most its own
 * duration, Infinity meaning until a later decision changes it.
 */
export interface Maneuver {
  readonly thrust: Axis;
  readonly thrustMs: number;
  readonly turn: Axis;
  readonly turnMs: number;
}

export interface FlightSetup {
  readonly handling: ShipHandling;
  readonly bounds: Rect;
  /** Everything the ship collides with: asteroids and containers alike. */
  readonly solids: readonly Circle[];
  readonly start: Point;
  readonly goal: Point;
  /** Any point this close to the goal is known to be clear for the whole hull. */
  readonly goalRadius: number;
}

interface Route {
  readonly points: readonly Point[];
  /** Distance along the route at each point. */
  readonly at: readonly number[];
  /** Highest speed to carry through each point: its corner, and a stop at the end. */
  readonly through: readonly number[];
}

interface RouteFix {
  readonly segment: number;
  /** Distance along the route. */
  readonly along: number;
  /** Signed distance from the route; positive to the left of its direction. */
  readonly offset: number;
  readonly tangent: Point;
}

const NEUTRAL: ShipControl = { thrust: 0, turn: 0 };
const ZERO: Point = { x: 0, y: 0 };
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

function distanceToSegment(p: Point, a: Point, b: Point): number {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const lengthSq = abx * abx + aby * aby;
  if (lengthSq === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = clamp(((p.x - a.x) * abx + (p.y - a.y) * aby) / lengthSq, 0, 1);
  return Math.hypot(p.x - (a.x + t * abx), p.y - (a.y + t * aby));
}

/** Free space between the hull and the nearest solid (or the sector edge) at `p`. */
function clearanceAt(p: Point, setup: FlightSetup): number {
  const { bounds, handling } = setup;
  let clearance =
    Math.min(p.x - bounds.minX, bounds.maxX - p.x, p.y - bounds.minY, bounds.maxY - p.y) -
    handling.radius;
  for (const solid of setup.solids) {
    clearance = Math.min(
      clearance,
      Math.hypot(p.x - solid.x, p.y - solid.y) - solid.radius - handling.radius,
    );
  }
  return clearance;
}

/** Minimal binary heap of cells by cost, for the route search. */
class CellQueue {
  readonly #cells: number[] = [];
  readonly #costs: number[] = [];

  get size(): number {
    return this.#cells.length;
  }

  push(cell: number, cost: number): void {
    let i = this.#cells.length;
    this.#cells.push(cell);
    this.#costs.push(cost);
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if ((this.#costs[parent] as number) <= cost) break;
      this.#swap(i, parent);
      i = parent;
    }
  }

  pop(): number {
    const top = this.#cells[0] as number;
    const lastCell = this.#cells.pop() as number;
    const lastCost = this.#costs.pop() as number;
    if (this.#cells.length > 0) {
      this.#cells[0] = lastCell;
      this.#costs[0] = lastCost;
      let i = 0;
      for (;;) {
        const left = 2 * i + 1;
        const right = left + 1;
        let smallest = i;
        if (
          left < this.#cells.length &&
          (this.#costs[left] as number) < (this.#costs[smallest] as number)
        ) {
          smallest = left;
        }
        if (
          right < this.#cells.length &&
          (this.#costs[right] as number) < (this.#costs[smallest] as number)
        ) {
          smallest = right;
        }
        if (smallest === i) break;
        this.#swap(i, smallest);
        i = smallest;
      }
    }
    return top;
  }

  #swap(a: number, b: number): void {
    [this.#cells[a], this.#cells[b]] = [this.#cells[b] as number, this.#cells[a] as number];
    [this.#costs[a], this.#costs[b]] = [this.#costs[b] as number, this.#costs[a] as number];
  }
}

/**
 * Grid search from the start to the goal area, the way the server itself checks that a
 * sector can be flown (apps/server/src/simulation/sector-generator.ts, findRoutes), but
 * weighted by clearance: the cheapest route passes through the middle of gaps and keeps
 * its distance from solids wherever the sector has room, instead of the shortest one
 * that grazes every solid it passes at the bare minimum. Null without a route.
 */
function searchRoute(setup: FlightSetup): Point[] | null {
  const { bounds, start, goal, goalRadius } = setup;
  const columns = Math.max(1, Math.floor((bounds.maxX - bounds.minX) / CELL));
  const rows = Math.max(1, Math.floor((bounds.maxY - bounds.minY) / CELL));
  const toColumn = (px: number) => clamp(Math.floor((px - bounds.minX) / CELL), 0, columns - 1);
  const toRow = (py: number) => clamp(Math.floor((py - bounds.minY) / CELL), 0, rows - 1);
  const center = (cell: number): Point => ({
    x: bounds.minX + ((cell % columns) + 0.5) * CELL,
    y: bounds.minY + (Math.floor(cell / columns) + 0.5) * CELL,
  });

  const clearance = new Float32Array(columns * rows);
  for (let cell = 0; cell < clearance.length; cell++) {
    clearance[cell] = clearanceAt(center(cell), setup);
  }
  const free = (cell: number) => (clearance[cell] as number) >= MIN_CLEARANCE;
  // Costlier the less room it leaves, up to (1 + CLEARANCE_COST) times at the minimum.
  const weight = (cell: number) =>
    1 +
    CLEARANCE_COST *
      clamp(
        (PREFERRED_CLEARANCE - (clearance[cell] as number)) / (PREFERRED_CLEARANCE - MIN_CLEARANCE),
        0,
        1,
      ) **
        2;

  const startCell = toRow(start.y) * columns + toColumn(start.x);
  if (!free(startCell)) return null;
  const cost = new Float64Array(columns * rows).fill(Infinity);
  const parent = new Int32Array(columns * rows).fill(-1);
  cost[startCell] = 0;
  parent[startCell] = startCell;
  const queue = new CellQueue();
  queue.push(startCell, 0);
  let target = -1;
  while (queue.size > 0) {
    const cell = queue.pop();
    const here = center(cell);
    if (Math.hypot(here.x - goal.x, here.y - goal.y) <= goalRadius) {
      target = cell;
      break;
    }
    const column = cell % columns;
    const row = Math.floor(cell / columns);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nextColumn = column + dx;
        const nextRow = row + dy;
        if (nextColumn < 0 || nextColumn >= columns || nextRow < 0 || nextRow >= rows) continue;
        const next = nextRow * columns + nextColumn;
        if (!free(next)) continue;
        const nextCost =
          (cost[cell] as number) + (dx !== 0 && dy !== 0 ? Math.SQRT2 : 1) * weight(next);
        if (nextCost >= (cost[next] as number)) continue;
        cost[next] = nextCost;
        parent[next] = cell;
        queue.push(next, nextCost);
      }
    }
  }
  if (target === -1) return null;

  const cells: number[] = [target];
  for (let cell = target; cell !== startCell; cell = parent[cell] as number) {
    cells.push(parent[cell] as number);
  }
  cells.reverse();
  // The start cell's center stands in for the ship's actual position.
  return [start, ...cells.slice(1).map(center)];
}

/**
 * Replaces runs of grid steps with straight legs, so the ship flies the route's shape and
 * not its every cell — but only where the straight leg keeps from every solid the room
 * the cells it replaces kept from that same solid (up to the preferred clearance): a
 * shortcut across one narrow gap must not then cut close to some other solid the search
 * went out of its way to keep clear of.
 */
function straighten(points: readonly Point[], setup: FlightSetup): Point[] {
  const { solids, handling } = setup;
  const room = (p: Point, solid: Circle) =>
    Math.hypot(p.x - solid.x, p.y - solid.y) - solid.radius - handling.radius;
  const result: Point[] = [points[0] as Point];
  let i = 0;
  while (i < points.length - 1) {
    const from = points[i] as Point;
    // Least room the route itself keeps from each solid, from point i up to point j.
    const kept = solids.map((solid) =>
      Math.min(room(from, solid), room(points[i + 1] as Point, solid)),
    );
    let next = i + 1;
    for (let j = i + 2; j < points.length; j++) {
      const to = points[j] as Point;
      solids.forEach((solid, k) => (kept[k] = Math.min(kept[k] as number, room(to, solid))));
      const keepsRoom = solids.every(
        (solid, k) =>
          distanceToSegment(solid, from, to) - solid.radius - handling.radius >=
          Math.min(kept[k] as number, PREFERRED_CLEARANCE) - HALF_DIAGONAL,
      );
      if (keepsRoom) next = j;
    }
    result.push(points[next] as Point);
    i = next;
  }
  return result;
}

function buildRoute(points: readonly Point[]): Route {
  const at = [0];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1] as Point;
    const b = points[i] as Point;
    at.push((at[i - 1] as number) + Math.hypot(b.x - a.x, b.y - a.y));
  }
  const through = points.map((point, i) => {
    if (i === 0) return CRUISE_SPEED;
    if (i === points.length - 1) return 0;
    const prev = points[i - 1] as Point;
    const next = points[i + 1] as Point;
    const turn = Math.abs(
      wrapAngle(
        Math.atan2(next.y - point.y, next.x - point.x) -
          Math.atan2(point.y - prev.y, point.x - prev.x),
      ),
    );
    if (turn >= Math.PI / 2) return SLOWEST_CORNER;
    return clamp(CORNER_SPEED / Math.max(Math.sin(turn), 1e-3), SLOWEST_CORNER, CRUISE_SPEED);
  });
  return { points, at, through };
}

/** Plans the route once; null when there is none (the server guarantees one exists). */
export function planFlight(setup: FlightSetup): Autopilot | null {
  const found = searchRoute(setup);
  if (!found) return null;
  const points = straighten(found, setup);
  const last = points[points.length - 1] as Point;
  if (Math.hypot(last.x - setup.goal.x, last.y - setup.goal.y) > 1) points.push(setup.goal);
  return new Autopilot(setup, buildRoute(points));
}

interface SentControl extends ShipControl {
  readonly at: number;
}

export class Autopilot {
  readonly #setup: FlightSetup;
  readonly #route: Route;
  readonly #geometry: SectorGeometry;
  #segment = 0;
  #latest: ShipReading | null = null;
  readonly #readings: { readonly tick: number; readonly angle: number }[] = [];
  /** Local time of server tick 0, as seen from the freshest reading so far. */
  #tickZeroMs = Infinity;
  readonly #sent: SentControl[] = [{ at: -Infinity, thrust: 0, turn: 0 }];
  #delayMs = INITIAL_DELAY_MS;
  readonly #cycles: number[] = [];
  #lastDecisionAt: number | null = null;
  #lastStatus = '';
  #overriding = false;

  constructor(setup: FlightSetup, route: Route) {
    this.#setup = setup;
    this.#route = route;
    this.#geometry = { bounds: setup.bounds, obstacles: setup.solids };
  }

  /** The planned route, for diagnostics. */
  get waypoints(): readonly Point[] {
    return this.#route.points;
  }

  /** One-line summary of the last decision, for diagnostics. */
  get status(): string {
    return this.#lastStatus;
  }

  /** Whether the last decision was the safety check's, overruling the route's. */
  get overriding(): boolean {
    return this.#overriding;
  }

  /** Records the state read at local time `atMs`. */
  observe(reading: ShipReading, atMs: number): void {
    this.#latest = reading;
    this.#tickZeroMs = Math.min(this.#tickZeroMs, atMs - reading.tick * STEP_MS);
    const previous = this.#readings.at(-1);
    if (!previous || previous.tick !== reading.tick) {
      this.#readings.push({ tick: reading.tick, angle: reading.angle });
      if (this.#readings.length > DELAY_WINDOW) this.#readings.shift();
    }
  }

  /** Records the keys held from local time `atMs` on, exactly as they were sent. */
  sent(control: ShipControl, atMs: number): void {
    this.#sent.push({ at: atMs, thrust: control.thrust, turn: control.turn });
    // Only what can still matter to a prediction or to measuring the delay.
    while (this.#sent.length > 200) this.#sent.shift();
  }

  /** Decides the keys to press now, as of local time `nowMs`. */
  decide(nowMs: number): Maneuver {
    const reading = this.#latest;
    if (!reading) return { thrust: 0, thrustMs: 0, turn: 0, turnMs: 0 };
    if (this.#lastDecisionAt !== null) {
      this.#cycles.push(nowMs - this.#lastDecisionAt);
      if (this.#cycles.length > 12) this.#cycles.shift();
    }
    this.#lastDecisionAt = nowMs;
    this.#measureDelay();

    const state = this.#predict(reading, nowMs + this.#delayMs);
    const cycleMs = this.#cycleMs();
    const desired = this.#desiredVelocity(state, cycleMs);
    const nominal = this.#maneuverToward(state, desired, cycleMs);
    const { maneuver, gap, overridden } = this.#safest(state, nominal, cycleMs);
    this.#overriding = overridden;
    const speed = Math.hypot(state.velocity.x, state.velocity.y);
    this.#lastStatus =
      `seg=${this.#segment + 1}/${this.#route.points.length - 1} ` +
      `speed=${speed.toFixed(0)} want=${Math.hypot(desired.x, desired.y).toFixed(0)} ` +
      `gap=${gap.toFixed(0)} delay=${this.#delayMs} cycle=${cycleMs.toFixed(0)}` +
      (overridden ? ' SAFETY' : '');
    return maneuver;
  }

  /** Expected time between two decisions taking effect. */
  #cycleMs(): number {
    if (this.#cycles.length === 0) return 300;
    const sorted = [...this.#cycles].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length * 0.75)] as number;
  }

  /** The keys held at local time `ms`, from the record of what was sent (in send order). */
  #controlAt(ms: number): ShipControl {
    let low = 0;
    let high = this.#sent.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if ((this.#sent[middle] as SentControl).at <= ms) low = middle + 1;
      else high = middle;
    }
    return low === 0 ? NEUTRAL : (this.#sent[low - 1] as SentControl);
  }

  /**
   * Finds the delay that best explains how the ship actually turned between recent
   * readings, given when each turn key was sent: rotation is exact (turnRate per tick
   * while held), so this measures the real pipeline — key event, frame, input flush,
   * server tick — on whatever machine this runs, instead of assuming one.
   */
  #measureDelay(): void {
    const readings = this.#readings;
    if (readings.length < 8) return;
    let turned = 0;
    for (let i = 1; i < readings.length; i++) {
      turned += Math.abs(
        wrapAngle(
          (readings[i] as { angle: number }).angle - (readings[i - 1] as { angle: number }).angle,
        ),
      );
    }
    if (turned < 0.3) return;
    const perTick = this.#setup.handling.turnRate * STEP_SECONDS;
    let best = this.#delayMs;
    let bestError = Infinity;
    for (const delay of DELAY_CANDIDATES_MS) {
      let error = 0;
      for (let i = 1; i < readings.length; i++) {
        const from = readings[i - 1] as { tick: number; angle: number };
        const to = readings[i] as { tick: number; angle: number };
        let predicted = 0;
        for (let tick = from.tick + 1; tick <= to.tick; tick++) {
          predicted += this.#controlAt(tick * STEP_MS + this.#tickZeroMs - delay).turn * perTick;
        }
        error += Math.abs(wrapAngle(to.angle - from.angle - predicted));
      }
      if (error < bestError - 1e-9) {
        bestError = error;
        best = delay;
      }
    }
    this.#delayMs = best;
  }

  /** Where the ship will be at local time `untilMs`, under the keys already sent. */
  #predict(reading: ShipReading, untilMs: number): ShipKinematics {
    let state: ShipKinematics = {
      position: { x: reading.x, y: reading.y },
      velocity: { x: reading.vx, y: reading.vy },
      angle: reading.angle,
    };
    for (let tick = reading.tick + 1; tick * STEP_MS + this.#tickZeroMs <= untilMs; tick++) {
      const control = this.#controlAt(tick * STEP_MS + this.#tickZeroMs - this.#delayMs);
      state = stepShip(state, control, STEP_SECONDS, this.#setup.handling, this.#geometry).state;
    }
    return state;
  }

  #fix(segment: number, p: Point): RouteFix & { readonly distance: number; readonly t: number } {
    const { points, at } = this.#route;
    const a = points[segment] as Point;
    const b = points[segment + 1] as Point;
    const length = Math.max(1e-6, Math.hypot(b.x - a.x, b.y - a.y));
    const tangent = { x: (b.x - a.x) / length, y: (b.y - a.y) / length };
    const t = (p.x - a.x) * tangent.x + (p.y - a.y) * tangent.y;
    const offset = tangent.x * (p.y - a.y) - tangent.y * (p.x - a.x);
    const clamped = clamp(t, 0, length);
    const distance = Math.hypot(
      p.x - (a.x + tangent.x * clamped),
      p.y - (a.y + tangent.y * clamped),
    );
    return {
      segment,
      along: (at[segment] as number) + t,
      offset,
      tangent,
      distance,
      t: t / length,
    };
  }

  /**
   * Progress along the route; never goes back to a leg already left behind, and only
   * moves on to the next one past the end of the current leg or right at its corner —
   * merely being closer to a later leg is not enough, since a route doubling back around
   * a solid passes near itself on both sides of it.
   */
  #locate(p: Point): RouteFix {
    const { points } = this.#route;
    let fix = this.#fix(this.#segment, p);
    while (fix.segment < points.length - 2) {
      const corner = points[fix.segment + 1] as Point;
      const next = this.#fix(fix.segment + 1, p);
      const atCorner =
        Math.hypot(p.x - corner.x, p.y - corner.y) < CORNER_REACH && next.distance <= fix.distance;
      if (fix.t < 1 && !atCorner) break;
      fix = next;
    }
    this.#segment = fix.segment;
    return fix;
  }

  /** Highest speed from `along` on that can still slow down for every corner ahead in time. */
  #speedLimit(along: number, reach: number): number {
    const { at, through } = this.#route;
    let limit = CRUISE_SPEED;
    for (let i = this.#segment + 1; i < at.length; i++) {
      const ahead = Math.max(0, (at[i] as number) - along - reach);
      limit = Math.min(limit, Math.sqrt((through[i] as number) ** 2 + 2 * PLANNED_BRAKING * ahead));
    }
    return limit;
  }

  #desiredVelocity(state: ShipKinematics, cycleMs: number): Point {
    const p = state.position;
    const speed = Math.hypot(state.velocity.x, state.velocity.y);
    // Distance covered before a correction decided now can even start to act.
    const reach = (speed * (this.#delayMs + cycleMs)) / 1000;
    const fix = this.#locate(p);
    const { points, at } = this.#route;
    const goal = points[points.length - 1] as Point;
    const toGoal = { x: goal.x - p.x, y: goal.y - p.y };
    const goalDistance = Math.hypot(toGoal.x, toGoal.y);
    if (fix.segment === points.length - 2 && (at[at.length - 1] as number) - fix.along < 400) {
      // Final approach: straight to the goal, slowing to a stop next to it — by the
      // distance to the goal itself, not along the route, which says "stop" anywhere
      // abreast of the goal, however far to its side.
      if (goalDistance <= STOP_RADIUS) return ZERO;
      const wanted = Math.min(
        CRUISE_SPEED,
        Math.sqrt(2 * PLANNED_BRAKING * Math.max(0, goalDistance - STOP_RADIUS - reach)),
      );
      return { x: (toGoal.x / goalDistance) * wanted, y: (toGoal.y / goalDistance) * wanted };
    }
    const along = this.#speedLimit(fix.along, reach);
    const lateralLimit = Math.max(25, 0.5 * along);
    const lateral = clamp(-LATERAL_GAIN * fix.offset, -lateralLimit, lateralLimit);
    // Left normal of the tangent: (-ty, tx).
    return {
      x: fix.tangent.x * along - fix.tangent.y * lateral,
      y: fix.tangent.y * along + fix.tangent.x * lateral,
    };
  }

  /**
   * Keys that move the ship's velocity towards `desired`. Thrust only pushes along the
   * facing, so the facing has to be turned first: forward thrust along the needed change,
   * or reverse thrust against it, whichever gets it done sooner — which, when braking a
   * ship already pointing where it goes, is plain reverse thrust.
   */
  #maneuverToward(state: ShipKinematics, desired: Point, cycleMs: number): Maneuver {
    const { handling } = this.#setup;
    const change = { x: desired.x - state.velocity.x, y: desired.y - state.velocity.y };
    const needed = Math.hypot(change.x, change.y);
    const pulse = (radians: number): { turn: Axis; turnMs: number } => {
      const ms = (Math.abs(radians) / handling.turnRate) * 1000;
      if (ms < SHORTEST_PULSE_MS) return { turn: 0, turnMs: 0 };
      return { turn: radians > 0 ? 1 : -1, turnMs: ms >= cycleMs ? Infinity : ms };
    };
    if (needed < SPEED_TOLERANCE) {
      // Nothing to fix: keep the nose along the way it should go, ready for either key.
      const wantedSpeed = Math.hypot(desired.x, desired.y);
      if (wantedSpeed < 20) return { thrust: 0, thrustMs: 0, turn: 0, turnMs: 0 };
      return {
        thrust: 0,
        thrustMs: 0,
        ...pulse(wrapAngle(Math.atan2(desired.y, desired.x) - state.angle)),
      };
    }
    const towards = Math.atan2(change.y, change.x);
    const forward = wrapAngle(towards - state.angle);
    const reverse = wrapAngle(towards + Math.PI - state.angle);
    const forwardTime =
      Math.abs(forward) / handling.turnRate + needed / handling.thrustAcceleration;
    const reverseTime =
      Math.abs(reverse) / handling.turnRate + needed / handling.reverseAcceleration;
    const useForward = forwardTime <= reverseTime;
    const error = useForward ? forward : reverse;
    const acceleration = useForward ? handling.thrustAcceleration : handling.reverseAcceleration;
    const burnMs =
      Math.abs(error) <= ALIGNED ? ((needed * Math.cos(error)) / acceleration) * 1000 : 0;
    return {
      thrust: burnMs > 0 ? (useForward ? 1 : -1) : 0,
      thrustMs: burnMs >= cycleMs ? Infinity : burnMs,
      ...pulse(error),
    };
  }

  /** Least gap between the hull and any solid at `p`; negative inside one. */
  #gap(p: Point, solids: readonly Circle[]): number {
    let gap = Infinity;
    for (const solid of solids) {
      gap = Math.min(
        gap,
        Math.hypot(p.x - solid.x, p.y - solid.y) - solid.radius - this.#setup.handling.radius,
      );
    }
    return gap;
  }

  /**
   * Plays `first` out for one cycle with the real handling model, then the brake this
   * autopilot itself would apply from there, one decision per cycle: the least gap to
   * any solid on the way, minus the impact speed of any contact. A decision whose
   * outcome can still be braked to a stop short of everything is safe to send.
   */
  #rollout(start: ShipKinematics, first: Maneuver, cycleMs: number, solids: readonly Circle[]) {
    const geometry: SectorGeometry = { bounds: this.#setup.bounds, obstacles: solids };
    let state = start;
    let maneuver = first;
    let startedAt = 0;
    let nextDecision = Math.max(
      cycleMs,
      Number.isFinite(first.turnMs) ? first.turnMs : 0,
      Number.isFinite(first.thrustMs) ? first.thrustMs : 0,
    );
    let least = this.#gap(state.position, solids);
    for (let t = 0; t < SAFETY_HORIZON_MS; t += STEP_MS) {
      if (t >= nextDecision) {
        maneuver = this.#maneuverToward(state, ZERO, cycleMs);
        startedAt = t;
        nextDecision = t + cycleMs;
        if (
          maneuver.thrust === 0 &&
          maneuver.turn === 0 &&
          Math.hypot(state.velocity.x, state.velocity.y) < 5
        ) {
          break;
        }
      }
      const elapsed = t - startedAt;
      const control = {
        thrust: elapsed < maneuver.thrustMs ? maneuver.thrust : 0,
        turn: elapsed < maneuver.turnMs ? maneuver.turn : 0,
      };
      const step = stepShip(state, control, STEP_SECONDS, this.#setup.handling, geometry);
      state = step.state;
      least = Math.min(least, this.#gap(state.position, solids) - step.impactSpeed);
    }
    return least;
  }

  #safest(state: ShipKinematics, nominal: Maneuver, cycleMs: number) {
    // Only what the ship could reach within the horizon matters.
    const speed = Math.hypot(state.velocity.x, state.velocity.y);
    const reach = this.#setup.handling.radius + speed * (SAFETY_HORIZON_MS / 1000) + 600;
    const solids = this.#setup.solids.filter(
      (solid) =>
        Math.hypot(solid.x - state.position.x, solid.y - state.position.y) - solid.radius < reach,
    );
    const nominalGap = this.#rollout(state, nominal, cycleMs, solids);
    if (nominalGap >= SAFE_GAP) return { maneuver: nominal, gap: nominalGap, overridden: false };
    const hold = (thrust: Axis, turn: Axis): Maneuver => ({
      thrust,
      thrustMs: Infinity,
      turn,
      turnMs: Infinity,
    });
    const candidates: Maneuver[] = [this.#maneuverToward(state, ZERO, cycleMs)];
    for (const thrust of [0, -1, 1] as const) {
      for (const turn of [0, -1, 1] as const) candidates.push(hold(thrust, turn));
    }
    let best = { maneuver: nominal, gap: nominalGap, overridden: false };
    for (const candidate of candidates) {
      const gap = this.#rollout(state, candidate, cycleMs, solids);
      if (gap > best.gap + 1) best = { maneuver: candidate, gap, overridden: true };
    }
    return best;
  }
}

/** What a flight needs from the game: the ship's state, the keys, and the time. */
export interface Cockpit {
  /** The latest authoritative ship state; null once the mission is gone. */
  read(): Promise<ShipReading | null>;
  key(code: 'KeyW' | 'KeyS' | 'KeyA' | 'KeyD', down: boolean): Promise<void>;
  sleep(ms: number): Promise<void>;
  now(): number;
}

export interface FlightOptions {
  readonly deadlineMs: number;
  /** Whether the ship is where it should end, stopped enough to stay there. */
  arrived(reading: ShipReading): boolean;
  /** Called after every decision, for diagnostics. */
  onDecision?(reading: ShipReading, maneuver: Maneuver): void;
}

/** No decision loop faster than the server can show its effect. */
const MIN_CYCLE_MS = STEP_MS + 10;

const keyFor = (axis: 'thrust' | 'turn', value: -1 | 1) =>
  axis === 'thrust' ? (value > 0 ? 'KeyW' : 'KeyS') : value > 0 ? 'KeyD' : 'KeyA';

/**
 * Flies `pilot`'s route: reads the ship, decides, presses the keys, releases each one when
 * its pulse is over, and repeats. Returns 'reached' once `arrived`, 'disconnected' when
 * the mission state disappears (ship destroyed, mission over), or 'gave-up' past the
 * deadline. Always leaves every key released.
 */
export async function fly(
  cockpit: Cockpit,
  pilot: Autopilot,
  options: FlightOptions,
): Promise<'reached' | 'disconnected' | 'gave-up'> {
  const held: { thrust: Axis; turn: Axis } = { thrust: 0, turn: 0 };
  /** Changes one axis; returns when the change was sent, the start of its pulse. */
  const set = async (axis: 'thrust' | 'turn', value: Axis): Promise<number> => {
    const at = cockpit.now();
    const current = held[axis];
    if (current === value) return at;
    if (current !== 0) await cockpit.key(keyFor(axis, current), false);
    if (value !== 0) await cockpit.key(keyFor(axis, value), true);
    held[axis] = value;
    pilot.sent({ ...held }, at);
    return at;
  };

  try {
    for (;;) {
      if (cockpit.now() > options.deadlineMs) return 'gave-up';
      const cycleStart = cockpit.now();
      const reading = await cockpit.read();
      if (!reading) return 'disconnected';
      pilot.observe(reading, cockpit.now());
      if (options.arrived(reading)) return 'reached';
      const maneuver = pilot.decide(cockpit.now());
      options.onDecision?.(reading, maneuver);
      const releases: { axis: 'thrust' | 'turn'; at: number }[] = [];
      for (const axis of ['thrust', 'turn'] as const) {
        const startedAt = await set(axis, maneuver[axis]);
        const ms = axis === 'thrust' ? maneuver.thrustMs : maneuver.turnMs;
        if (maneuver[axis] !== 0 && Number.isFinite(ms)) {
          releases.push({ axis, at: startedAt + ms });
        }
      }
      releases.sort((a, b) => a.at - b.at);
      for (const release of releases) {
        await cockpit.sleep(release.at - cockpit.now());
        await set(release.axis, 0);
      }
      await cockpit.sleep(cycleStart + MIN_CYCLE_MS - cockpit.now());
    }
  } finally {
    // The page may already be gone (mission over): nothing left to release then.
    await set('thrust', 0).catch(() => undefined);
    await set('turn', 0).catch(() => undefined);
  }
}
