/**
 * Counts refused messages per connection in a sliding window. A few invalid
 * messages are just rejected; sustained abuse disconnects the client.
 */
export class ViolationBudget {
  readonly #limit: number;
  readonly #windowMs: number;
  readonly #timestamps: number[] = [];

  constructor(limit: number, windowMs: number) {
    this.#limit = limit;
    this.#windowMs = windowMs;
  }

  /** Records one violation; returns true once the budget is exhausted. */
  record(nowMs: number): boolean {
    this.#timestamps.push(nowMs);
    while (this.#timestamps.length > 0 && nowMs - (this.#timestamps[0] ?? nowMs) > this.#windowMs) {
      this.#timestamps.shift();
    }
    return this.#timestamps.length > this.#limit;
  }
}
