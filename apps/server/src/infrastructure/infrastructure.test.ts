import { describe, expect, it } from 'vitest';
import { OverloadedError, Semaphore } from './semaphore';
import { SlidingWindowLimiter } from './sliding-window-limiter';

describe('SlidingWindowLimiter', () => {
  it('limits per key inside the window and recovers after it', () => {
    let now = 0;
    const limiter = new SlidingWindowLimiter({ limit: 2, windowMs: 1000, now: () => now });
    expect(limiter.tryConsume('a')).toBe(true);
    expect(limiter.tryConsume('a')).toBe(true);
    expect(limiter.tryConsume('a')).toBe(false);
    expect(limiter.tryConsume('b')).toBe(true);
    now = 1001;
    expect(limiter.tryConsume('a')).toBe(true);
    limiter.reset('a');
    expect(limiter.isLimited('a')).toBe(false);
  });
});

describe('Semaphore', () => {
  it('never runs more than `max` tasks at once and refuses beyond the queue', async () => {
    const semaphore = new Semaphore({ max: 2, maxQueue: 3 });
    const gates: (() => void)[] = [];
    const task = () => new Promise<void>((resolve) => gates.push(resolve));
    const running = Array.from({ length: 5 }, () => semaphore.run(task));
    await expect(semaphore.run(task)).rejects.toBeInstanceOf(OverloadedError);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(gates).toHaveLength(2);
    while (gates.length > 0) {
      gates.shift()?.();
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    await Promise.all(running);
    expect(semaphore.peak).toBe(2);
  });
});
