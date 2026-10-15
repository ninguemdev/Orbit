import { lerp, lerpAngle } from '@orbit/simulation';
import type { CrewSnapshot, WorldSnapshot } from './world-snapshot';

const DEFAULT_CAPACITY = 32;

/**
 * Keeps recent server snapshots and renders the world slightly in the past,
 * interpolating between the two snapshots around the render time. Discrete fields
 * (names, helm, connection) come from the newer snapshot.
 */
export class SnapshotBuffer {
  readonly #items: WorldSnapshot[] = [];
  readonly #capacity: number;

  constructor(capacity = DEFAULT_CAPACITY) {
    this.#capacity = capacity;
  }

  push(snapshot: WorldSnapshot): void {
    const last = this.#items.at(-1);
    if (last && snapshot.tick < last.tick) return; // Late duplicate.
    this.#items.push(snapshot);
    if (this.#items.length > this.#capacity) this.#items.shift();
  }

  latest(): WorldSnapshot | null {
    return this.#items.at(-1) ?? null;
  }

  sample(renderTime: number): WorldSnapshot | null {
    const items = this.#items;
    const first = items[0];
    if (!first) return null;
    if (renderTime <= first.receivedAt) return first;
    for (let i = items.length - 1; i > 0; i--) {
      const older = items[i - 1];
      const newer = items[i];
      if (!older || !newer) continue;
      if (older.receivedAt <= renderTime && renderTime < newer.receivedAt) {
        const span = newer.receivedAt - older.receivedAt;
        const alpha = span > 0 ? (renderTime - older.receivedAt) / span : 1;
        return interpolateSnapshots(older, newer, alpha);
      }
    }
    // Render time is past the newest snapshot: hold the last authorized state.
    return items.at(-1) ?? null;
  }

  clear(): void {
    this.#items.length = 0;
  }
}

export function interpolateSnapshots(
  older: WorldSnapshot,
  newer: WorldSnapshot,
  alpha: number,
): WorldSnapshot {
  const position = lerp(older.ship, newer.ship, alpha);
  const crew = new Map<string, CrewSnapshot>();
  for (const [id, member] of newer.crew) {
    const previous = older.crew.get(id);
    crew.set(id, previous ? { ...member, ...lerp(previous, member, alpha) } : member);
  }
  return {
    ...newer,
    receivedAt: older.receivedAt + (newer.receivedAt - older.receivedAt) * alpha,
    ship: {
      ...newer.ship,
      x: position.x,
      y: position.y,
      angle: lerpAngle(older.ship.angle, newer.ship.angle, alpha),
    },
    crew,
  };
}
