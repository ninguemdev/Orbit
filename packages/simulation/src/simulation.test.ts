import { describe, expect, it } from 'vitest';
import {
  ContinuousInputGate,
  applyModifiers,
  clampLength,
  distance,
  isFiniteVec,
  lerpAngle,
  moveCircleThroughRects,
  resolveCircleRect,
  stepCrew,
  stepShip,
  sweepCircle,
  wrapAngle,
  type Rect,
  type ShipHandling,
} from './index';

const bounds: Rect = { minX: -1000, minY: -1000, maxX: 1000, maxY: 1000 };

describe('vec2', () => {
  it('wraps and interpolates angles along the shortest arc', () => {
    expect(wrapAngle(3 * Math.PI)).toBeCloseTo(Math.PI);
    expect(wrapAngle(-3 * Math.PI)).toBeCloseTo(Math.PI);
    // From +170° to -170° goes through 180°, not through 0°.
    const mid = lerpAngle((170 * Math.PI) / 180, (-170 * Math.PI) / 180, 0.5);
    expect(Math.abs(mid)).toBeCloseTo(Math.PI);
  });

  it('clamps length without changing direction', () => {
    const v = clampLength({ x: 3, y: 4 }, 1);
    expect(v.x).toBeCloseTo(0.6);
    expect(v.y).toBeCloseTo(0.8);
    expect(isFiniteVec({ x: Number.NaN, y: 0 })).toBe(false);
  });
});

describe('applyModifiers', () => {
  it('sums additive modifiers, multiplies and clamps to caps', () => {
    const value = applyModifiers(
      100,
      'speed',
      [
        { stat: 'speed', kind: 'add', value: 20, source: 'item.boots' },
        { stat: 'speed', kind: 'multiply', value: 1.5, source: 'class.pilot' },
        { stat: 'armor', kind: 'add', value: 99, source: 'item.vest' },
      ],
      { min: 0, max: 170 },
    );
    expect(value).toBe(170);
  });

  it('rejects non-finite modifiers', () => {
    expect(() =>
      applyModifiers(
        1,
        'speed',
        [{ stat: 'speed', kind: 'multiply', value: Infinity, source: 'x' }],
        { min: 0, max: 10 },
      ),
    ).toThrow(RangeError);
  });
});

describe('collision', () => {
  it('pushes a circle out of a rectangle', () => {
    const wall: Rect = { minX: 0, minY: -50, maxX: 10, maxY: 50 };
    const resolved = resolveCircleRect({ x: -5, y: 0 }, 10, wall);
    expect(resolved.x).toBeCloseTo(-10);
  });

  it('does not tunnel through a thin wall with a large step', () => {
    const wall: Rect = { minX: 0, minY: -100, maxX: 2, maxY: 100 };
    const end = moveCircleThroughRects({ x: -20, y: 0 }, { x: 400, y: 0 }, 10, [wall], bounds, 5);
    expect(end.x).toBeLessThanOrEqual(-10 + 1e-6);
  });

  it('sweeps against a small obstacle that a discrete check would miss', () => {
    const hit = sweepCircle({ x: 0, y: 0 }, { x: 1000, y: 0 }, 10, [{ x: 500, y: 0, radius: 5 }]);
    expect(hit?.t).toBeCloseTo((500 - 15) / 1000);
    expect(hit?.normal.x).toBeCloseTo(-1);
  });
});

describe('stepCrew', () => {
  const params = { speed: 100, radius: 10, walls: [], bounds };

  it('moves at most speed × dt, including diagonals', () => {
    const end = stepCrew({ x: 0, y: 0 }, { x: 1, y: 1 }, 0.05, params);
    expect(distance({ x: 0, y: 0 }, end)).toBeCloseTo(5);
  });

  it('clamps oversized axes and ignores NaN/Infinity', () => {
    expect(stepCrew({ x: 0, y: 0 }, { x: 50, y: 0 }, 0.05, params).x).toBeCloseTo(5);
    const invalid = stepCrew({ x: 0, y: 0 }, { x: Number.NaN, y: Infinity }, 0.05, params);
    expect(invalid).toEqual({ x: 0, y: 0 });
  });
});

describe('stepShip', () => {
  const handling: ShipHandling = {
    maxSpeed: 200,
    thrustAcceleration: 100,
    reverseAcceleration: 50,
    turnRate: 2,
    linearDamping: 0,
    radius: 20,
  };
  const empty = { bounds, obstacles: [] };
  const rest = { position: { x: 0, y: 0 }, velocity: { x: 0, y: 0 }, angle: 0 };

  it('turns and accelerates along its heading', () => {
    const turned = stepShip(rest, { thrust: 0, turn: 1 }, 0.5, handling, empty);
    expect(turned.state.angle).toBeCloseTo(1);
    const moved = stepShip(rest, { thrust: 1, turn: 0 }, 1, handling, empty);
    expect(moved.state.velocity.x).toBeCloseTo(100);
    expect(moved.state.velocity.y).toBeCloseTo(0);
    expect(moved.impactSpeed).toBe(0);
  });

  it('never exceeds max speed', () => {
    let state = rest;
    for (let i = 0; i < 200; i++)
      state = stepShip(state, { thrust: 1, turn: 0 }, 0.05, handling, empty).state;
    expect(Math.hypot(state.velocity.x, state.velocity.y)).toBeLessThanOrEqual(200 + 1e-9);
  });

  it('stops at an obstacle instead of passing through it at high speed, reporting the impact', () => {
    const fast = { ...rest, velocity: { x: 200, y: 0 } };
    const sector = { bounds, obstacles: [{ x: 15, y: 0, radius: 2 }] };
    const after = stepShip(fast, { thrust: 0, turn: 0 }, 1, handling, sector);
    expect(after.state.position.x).toBeLessThan(15);
    expect(after.state.velocity.x).toBeCloseTo(0);
    expect(after.impactSpeed).toBeCloseTo(200);
  });

  it('reports no impact when gliding past without touching anything', () => {
    const grazing = { ...rest, position: { x: 0, y: 100 }, velocity: { x: 200, y: 0 } };
    const sector = { bounds, obstacles: [{ x: 15, y: 0, radius: 2 }] };
    const after = stepShip(grazing, { thrust: 0, turn: 0 }, 1, handling, sector);
    expect(after.impactSpeed).toBe(0);
  });

  it('stays inside the sector bounds', () => {
    const edge = { ...rest, position: { x: 990, y: 0 }, velocity: { x: 200, y: 0 } };
    const after = stepShip(edge, { thrust: 1, turn: 0 }, 1, handling, empty);
    expect(after.state.position.x).toBe(1000 - 20);
    expect(after.state.velocity.x).toBe(0);
  });
});

describe('ContinuousInputGate', () => {
  const neutral = { seq: -1, x: 0, y: 0 };
  const make = () => new ContinuousInputGate({ neutral, staleAfterMs: 250, maxSeqJump: 100 });

  it('keeps only the newest input; spam does not add steps', () => {
    const gate = make();
    for (let seq = 0; seq < 100; seq++) gate.offer({ seq, x: 1, y: 0 }, 0);
    expect(gate.current(0)).toEqual({ seq: 99, x: 1, y: 0 });
    expect(gate.lastSeq).toBe(99);
  });

  it('refuses duplicates, reordering and implausible jumps', () => {
    const gate = make();
    expect(gate.offer({ seq: 10, x: 1, y: 0 }, 0)).toBe('accepted');
    expect(gate.offer({ seq: 10, x: 1, y: 0 }, 0)).toBe('duplicate');
    expect(gate.offer({ seq: 9, x: -1, y: 0 }, 0)).toBe('out_of_order');
    expect(gate.offer({ seq: 500, x: -1, y: 0 }, 0)).toBe('too_far_ahead');
    expect(gate.current(0).x).toBe(1);
  });

  it('returns neutral once the input is stale or cleared, without allowing replay', () => {
    const gate = make();
    gate.offer({ seq: 1, x: 1, y: 0 }, 1000);
    expect(gate.current(1250).x).toBe(1);
    expect(gate.current(1251)).toBe(neutral);
    gate.offer({ seq: 2, x: 1, y: 0 }, 2000);
    gate.clear();
    expect(gate.current(2000)).toBe(neutral);
    expect(gate.offer({ seq: 2, x: 1, y: 0 }, 2000)).toBe('duplicate');
  });
});
