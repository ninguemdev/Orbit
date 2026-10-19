import {
  type Circle,
  type Rect,
  containCircle,
  separateFromCircles,
  sweepCircle,
} from './collision';
import { type Vec2, add, clamp, clampLength, dot, fromAngle, scale, sub, wrapAngle } from './vec2';

export interface ShipKinematics {
  readonly position: Vec2;
  readonly velocity: Vec2;
  /** Heading in radians; 0 points to +x. */
  readonly angle: number;
}

export interface ShipControl {
  /** -1 (reverse/brake) … 1 (full forward). */
  readonly thrust: number;
  /** -1 (counter-clockwise) … 1 (clockwise). */
  readonly turn: number;
}

export interface ShipHandling {
  readonly maxSpeed: number;
  readonly thrustAcceleration: number;
  readonly reverseAcceleration: number;
  /** rad/s at full turn input. */
  readonly turnRate: number;
  /** Exponential velocity damping per second. */
  readonly linearDamping: number;
  readonly radius: number;
}

export interface SectorGeometry {
  readonly bounds: Rect;
  readonly obstacles: readonly Circle[];
}

export const NEUTRAL_SHIP_CONTROL: ShipControl = Object.freeze({ thrust: 0, turn: 0 });

export interface ShipStepResult {
  readonly state: ShipKinematics;
  /**
   * Inward speed removed by collisions this step, summed over every obstacle the
   * sweep touched; 0 without contact. A graze at a shallow angle barely registers,
   * a head-on hit carries most of the speed into it.
   */
  readonly impactSpeed: number;
}

function sanitizeControl(control: ShipControl): ShipControl {
  return {
    thrust: Number.isFinite(control.thrust) ? clamp(control.thrust, -1, 1) : 0,
    turn: Number.isFinite(control.turn) ? clamp(control.turn, -1, 1) : 0,
  };
}

/** Removes the velocity component that points into a surface. */
function slide(vector: Vec2, normal: Vec2): Vec2 {
  const into = dot(vector, normal);
  return into < 0 ? sub(vector, scale(normal, into)) : vector;
}

/**
 * Advances the ship by one fixed step: rotation, thrust, damping, speed cap, then
 * continuous collision against obstacles with sliding, and sector bounds.
 */
export function stepShip(
  state: ShipKinematics,
  rawControl: ShipControl,
  dtSeconds: number,
  handling: ShipHandling,
  sector: SectorGeometry,
): ShipStepResult {
  const control = sanitizeControl(rawControl);
  const angle = wrapAngle(state.angle + control.turn * handling.turnRate * dtSeconds);
  const acceleration =
    control.thrust >= 0
      ? control.thrust * handling.thrustAcceleration
      : control.thrust * handling.reverseAcceleration;
  let velocity = add(state.velocity, fromAngle(angle, acceleration * dtSeconds));
  velocity = scale(velocity, Math.exp(-handling.linearDamping * dtSeconds));
  velocity = clampLength(velocity, handling.maxSpeed);

  let position = state.position;
  let remaining = scale(velocity, dtSeconds);
  let impactSpeed = 0;
  for (let iteration = 0; iteration < 3; iteration++) {
    const hit = sweepCircle(position, remaining, handling.radius, sector.obstacles);
    if (hit === null) {
      position = add(position, remaining);
      break;
    }
    position = add(position, scale(remaining, hit.t));
    const inward = dot(velocity, hit.normal);
    if (inward < 0) impactSpeed += -inward;
    remaining = slide(scale(remaining, 1 - hit.t), hit.normal);
    velocity = slide(velocity, hit.normal);
  }
  position = separateFromCircles(position, handling.radius, sector.obstacles);

  const contained = containCircle(position, handling.radius, sector.bounds);
  if (contained.x !== position.x) velocity = { x: 0, y: velocity.y };
  if (contained.y !== position.y) velocity = { x: velocity.x, y: 0 };

  return { state: { position: contained, velocity, angle }, impactSpeed };
}
