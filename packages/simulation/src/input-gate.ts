/**
 * Holds the latest continuous input (movement axes, ship controls) of one player.
 *
 * The simulation reads it once per fixed tick, so sending more messages never
 * produces more movement steps. Duplicated, reordered or implausibly advanced
 * sequences are refused, and an input that is not refreshed within `staleAfterMs`
 * falls back to neutral so a lost key-up cannot keep an entity accelerating.
 */
export interface SequencedInput {
  readonly seq: number;
}

export type InputOfferResult = 'accepted' | 'duplicate' | 'out_of_order' | 'too_far_ahead';

export interface InputGateOptions<T> {
  readonly neutral: T;
  readonly staleAfterMs: number;
  /** Maximum accepted jump between consecutive sequence numbers. */
  readonly maxSeqJump: number;
}

export class ContinuousInputGate<T extends SequencedInput> {
  readonly #options: InputGateOptions<T>;
  #latest: T | null = null;
  #receivedAtMs = 0;
  #lastSeq = -1;

  constructor(options: InputGateOptions<T>) {
    this.#options = options;
  }

  get lastSeq(): number {
    return this.#lastSeq;
  }

  offer(input: T, nowMs: number): InputOfferResult {
    if (this.#lastSeq >= 0) {
      if (input.seq === this.#lastSeq) return 'duplicate';
      if (input.seq < this.#lastSeq) return 'out_of_order';
      if (input.seq - this.#lastSeq > this.#options.maxSeqJump) return 'too_far_ahead';
    }
    this.#latest = input;
    this.#lastSeq = input.seq;
    this.#receivedAtMs = nowMs;
    return 'accepted';
  }

  /** Input to apply on this tick; neutral when absent or stale. Does not consume. */
  current(nowMs: number): T {
    if (this.#latest === null) return this.#options.neutral;
    if (nowMs - this.#receivedAtMs > this.#options.staleAfterMs) return this.#options.neutral;
    return this.#latest;
  }

  /**
   * Drops the held input (console change, death, reconnection). The sequence
   * high-water mark is kept so old packets cannot be replayed afterwards.
   */
  clear(): void {
    this.#latest = null;
  }
}
