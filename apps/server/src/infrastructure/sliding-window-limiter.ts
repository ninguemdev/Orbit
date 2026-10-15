/**
 * Counts events per key inside a sliding time window, in process memory. One game
 * process serves all players for now; a shared store is only needed with several.
 */
export class SlidingWindowLimiter {
  readonly #limit: number;
  readonly #windowMs: number;
  readonly #now: () => number;
  readonly #events = new Map<string, number[]>();

  constructor(options: { limit: number; windowMs: number; now?: () => number }) {
    this.#limit = options.limit;
    this.#windowMs = options.windowMs;
    this.#now = options.now ?? Date.now;
  }

  /** True when the key already used its whole budget in the current window. */
  isLimited(key: string): boolean {
    return this.#recent(key).length >= this.#limit;
  }

  record(key: string): void {
    const recent = this.#recent(key);
    recent.push(this.#now());
    this.#events.set(key, recent);
    if (this.#events.size > 10_000) this.#sweep();
  }

  /** Records the event unless the key is limited; returns whether it was allowed. */
  tryConsume(key: string): boolean {
    if (this.isLimited(key)) return false;
    this.record(key);
    return true;
  }

  reset(key: string): void {
    this.#events.delete(key);
  }

  #recent(key: string): number[] {
    const since = this.#now() - this.#windowMs;
    return (this.#events.get(key) ?? []).filter((time) => time > since);
  }

  #sweep(): void {
    for (const key of [...this.#events.keys()]) {
      const recent = this.#recent(key);
      if (recent.length === 0) this.#events.delete(key);
      else this.#events.set(key, recent);
    }
  }
}
