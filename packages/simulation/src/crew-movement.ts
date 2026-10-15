import { type Rect, moveCircleThroughRects } from './collision';
import { type Vec2, clamp, clampLength, scale } from './vec2';

export interface MoveAxes {
  readonly x: number;
  readonly y: number;
}

export interface CrewMovementParams {
  /** Walking speed in px/s. */
  readonly speed: number;
  readonly radius: number;
  /** Interior walls in the coordinates of the space the crew member is in. */
  readonly walls: readonly Rect[];
  readonly bounds: Rect;
}

/** Converts raw axes into a direction with length ≤ 1; invalid numbers count as zero. */
export function sanitizeAxes(axes: MoveAxes): MoveAxes {
  const x = Number.isFinite(axes.x) ? clamp(axes.x, -1, 1) : 0;
  const y = Number.isFinite(axes.y) ? clamp(axes.y, -1, 1) : 0;
  return clampLength({ x, y }, 1);
}

/** Advances one crew member by one fixed step inside its space. */
export function stepCrew(
  position: Vec2,
  axes: MoveAxes,
  dtSeconds: number,
  params: CrewMovementParams,
): Vec2 {
  const direction = sanitizeAxes(axes);
  const delta = scale(direction, params.speed * dtSeconds);
  return moveCircleThroughRects(
    position,
    delta,
    params.radius,
    params.walls,
    params.bounds,
    params.radius * 0.5,
  );
}
