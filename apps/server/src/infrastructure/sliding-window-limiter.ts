/**
 * Counts events per key inside a sliding time window, in process memory. One game
 * process serves all players for now; a shared store is only needed with several.
 *
 * Memory is bounded: expired keys are swept at most once per window, and when
 * `maxKeys` is reached the least recently used key is evicted. Eviction can forget
 * an old counter under a flood of new keys; that is preferred to unbounded growth.
 */
export class SlidingWindowLimiter {
  readonly #limit: number;
  readonly #windowMs: number;
  readonly #maxKeys: number;
  readonly #now: () => number;
  readonly #events = new Map<string, number[]>();
  #lastSweep = 0;

  constructor(options: { limit: number; windowMs: number; maxKeys?: number; now?: () => number }) {
    this.#limit = options.limit;
    this.#windowMs = options.windowMs;
    this.#maxKeys = options.maxKeys ?? 50_000;
    this.#now = options.now ?? Date.now;
  }

  /** True when the key already used its whole budget in the current window. */
  isLimited(key: string): boolean {
    return this.#recent(key).length >= this.#limit;
  }

  /** Records the event unless the key is limited; returns whether it was allowed. */
  tryConsume(key: string): boolean {
    const recent = this.#recent(key);
    if (recent.length >= this.#limit) return false;
    recent.push(this.#now());
    this.#store(key, recent);
    return true;
  }

  reset(key: string): void {
    this.#events.delete(key);
  }

  get size(): number {
    return this.#events.size;
  }

  #recent(key: string): number[] {
    const since = this.#now() - this.#windowMs;
    return (this.#events.get(key) ?? []).filter((time) => time > since);
  }

  #store(key: string, recent: number[]): void {
    // Re-insert so Map order tracks recency for eviction.
    this.#events.delete(key);
    if (this.#events.size >= this.#maxKeys) {
      const oldest = this.#events.keys().next();
      if (!oldest.done) this.#events.delete(oldest.value);
    }
    this.#events.set(key, recent);
    const now = this.#now();
    if (now - this.#lastSweep >= this.#windowMs) {
      this.#lastSweep = now;
      for (const [other, times] of this.#events) {
        if (!times.some((time) => time > now - this.#windowMs)) this.#events.delete(other);
      }
    }
  }
}
