export class OverloadedError extends Error {
  constructor() {
    super('Capacidade esgotada');
    this.name = 'OverloadedError';
  }
}

/**
 * Bounds how many expensive tasks (password hashing) run at once. Extra callers
 * wait in a bounded queue; beyond it they are refused instead of piling up memory.
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
      this.#enter();
      return;
    }
    if (this.#queue.length >= this.#maxQueue) throw new OverloadedError();
    await new Promise<void>((resolve) => this.#queue.push(resolve));
    this.#enter();
  }

  #enter(): void {
    this.#active++;
    this.#peak = Math.max(this.#peak, this.#active);
  }

  #release(): void {
    this.#active--;
    this.#queue.shift()?.();
  }
}
