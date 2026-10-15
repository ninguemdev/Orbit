export class OverloadedError extends Error {
  constructor() {
    super('Capacidade esgotada');
    this.name = 'OverloadedError';
  }
}

/**
 * Bounds how many expensive tasks (password hashing) run at once. Extra callers
 * wait in a bounded queue; beyond it they are refused instead of piling up memory.
 * A finishing task hands its slot directly to the next waiter, so a caller arriving
 * in between cannot slip in and exceed the limit.
 */
export class Semaphore {
  readonly #max: number;
  readonly #maxQueue: number;
  #active = 0;
  #peak = 0;
  readonly #queue: (() => void)[] = [];

  constructor(options: { max: number; maxQueue: number }) {
    this.#max = options.max;
    this.#maxQueue = options.maxQueue;
  }

  /** Highest number of tasks observed running at the same time. */
  get peak(): number {
    return this.#peak;
  }

  async run<T>(task: () => Promise<T>): Promise<T> {
    await this.#acquire();
    try {
      return await task();
    } finally {
      this.#release();
    }
  }

  async #acquire(): Promise<void> {
    if (this.#active < this.#max) {
      this.#active++;
      this.#peak = Math.max(this.#peak, this.#active);
      return;
    }
    if (this.#queue.length >= this.#maxQueue) throw new OverloadedError();
    // Resolved by #release with the slot already counted in #active.
    await new Promise<void>((resolve) => this.#queue.push(resolve));
  }

  #release(): void {
    const next = this.#queue.shift();
    if (next) next();
    else this.#active--;
  }
}
