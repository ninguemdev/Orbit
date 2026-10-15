import { type Vec2, add, clamp, dot, length, scale, sub } from './vec2';

/** Axis-aligned rectangle used for interior walls and bounds. */
export interface Rect {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

export interface Circle {
  readonly x: number;
  readonly y: number;
  readonly radius: number;
}

const EPSILON = 1e-6;

/** Pushes a circle out of a rectangle. Returns the input position when they do not overlap. */
export function resolveCircleRect(center: Vec2, radius: number, rect: Rect): Vec2 {
  const closestX = clamp(center.x, rect.minX, rect.maxX);
  const closestY = clamp(center.y, rect.minY, rect.maxY);
  const dx = center.x - closestX;
  const dy = center.y - closestY;
  const distSq = dx * dx + dy * dy;
  if (distSq >= radius * radius) return center;
  if (distSq > EPSILON * EPSILON) {
    const dist = Math.sqrt(distSq);
    const push = (radius - dist) / dist;
    return { x: center.x + dx * push, y: center.y + dy * push };
  }
  // Center is inside the rectangle: leave through the side with the least penetration.
  const exits = [
    { depth: center.x - rect.minX + radius, x: rect.minX - radius, y: center.y },
    { depth: rect.maxX - center.x + radius, x: rect.maxX + radius, y: center.y },
    { depth: center.y - rect.minY + radius, x: center.x, y: rect.minY - radius },
    { depth: rect.maxY - center.y + radius, x: center.x, y: rect.maxY + radius },
  ];
  const best = exits.reduce((a, b) => (b.depth < a.depth ? b : a));
  return { x: best.x, y: best.y };
}

/** Keeps a circle fully inside `bounds`. */
export function containCircle(center: Vec2, radius: number, bounds: Rect): Vec2 {
  return {
    x: clamp(center.x, bounds.minX + radius, bounds.maxX - radius),
    y: clamp(center.y, bounds.minY + radius, bounds.maxY - radius),
  };
}

/**
 * Moves a circle by `delta` in sub-steps no longer than `maxStep`, resolving wall
 * overlaps after each one so fast movement cannot tunnel through thin walls.
 */
export function moveCircleThroughRects(
  start: Vec2,
  delta: Vec2,
  radius: number,
  walls: readonly Rect[],
  bounds: Rect,
  maxStep: number,
): Vec2 {
  const distance = length(delta);
  const steps = Math.max(1, Math.ceil(distance / Math.max(maxStep, EPSILON)));
  const step = scale(delta, 1 / steps);
  let position = start;
  for (let i = 0; i < steps; i++) {
    position = add(position, step);
    // Two passes settle corners where two walls push in different directions.
    for (let pass = 0; pass < 2; pass++) {
      for (const wall of walls) position = resolveCircleRect(position, radius, wall);
    }
    position = containCircle(position, radius, bounds);
  }
  return position;
}

export interface SweepHit {
  /** Fraction of `delta` travelled before contact, in [0, 1]. */
  readonly t: number;
  /** Unit normal pointing from the obstacle towards the moving circle at contact. */
  readonly normal: Vec2;
  readonly obstacleIndex: number;
}

/**
 * Continuous collision of a moving circle against static circles. Finds the first
 * contact along the segment instead of testing only the final position.
 */
export function sweepCircle(
  start: Vec2,
  delta: Vec2,
  radius: number,
  obstacles: readonly Circle[],
): SweepHit | null {
  let best: SweepHit | null = null;
  const a = dot(delta, delta);
  obstacles.forEach((obstacle, obstacleIndex) => {
    const combined = radius + obstacle.radius;
    const offset = sub(start, obstacle);
    const c = dot(offset, offset) - combined * combined;
    if (c <= 0) {
      // Already touching: only a contact if moving further in.
      const dist = length(offset);
      const normal = dist > EPSILON ? scale(offset, 1 / dist) : { x: 1, y: 0 };
      if (dot(delta, normal) < 0 && (best === null || best.t > 0)) {
        best = { t: 0, normal, obstacleIndex };
      }
      return;
    }
    if (a <= EPSILON) return;
    const b = dot(offset, delta);
    if (b >= 0) return; // Moving away.
    const discriminant = b * b - a * c;
    if (discriminant < 0) return;
    const t = (-b - Math.sqrt(discriminant)) / a;
    if (t < 0 || t > 1) return;
    if (best === null || t < best.t) {
      const contact = add(start, scale(delta, t));
      const normal = scale(sub(contact, obstacle), 1 / combined);
      best = { t, normal, obstacleIndex };
    }
  });
  return best;
}

/** Pushes a circle out of any static circle it overlaps. */
export function separateFromCircles(
  center: Vec2,
  radius: number,
  obstacles: readonly Circle[],
): Vec2 {
  let position = center;
  for (const obstacle of obstacles) {
    const offset = sub(position, obstacle);
    const dist = length(offset);
    const combined = radius + obstacle.radius;
    if (dist >= combined) continue;
    const normal = dist > EPSILON ? scale(offset, 1 / dist) : { x: 1, y: 0 };
    position = add(obstacle, scale(normal, combined + EPSILON));
  }
  return position;
}
