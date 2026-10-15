import { describe, expect, it } from 'vitest';
import { clientAddressKey } from './client-address';
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

  it('keeps memory bounded under a flood of distinct keys', () => {
    let now = 0;
    const limiter = new SlidingWindowLimiter({
      limit: 1,
      windowMs: 1000,
      maxKeys: 100,
      now: () => now,
    });
    for (let i = 0; i < 10_000; i++) limiter.tryConsume(`key-${i}`);
    expect(limiter.size).toBe(100);
    now = 5000;
    limiter.tryConsume('fresh');
    expect(limiter.size).toBe(1);
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

  it('hands a released slot to the waiter, not to a caller arriving meanwhile', async () => {
    const semaphore = new Semaphore({ max: 1, maxQueue: 5 });
    let active = 0;
    let peak = 0;
    const task = async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active--;
    };
    const first = semaphore.run(task);
    const waiter = semaphore.run(task);
    // A caller scheduled right when the first task finishes.
    const late = first.then(() => semaphore.run(task));
    await Promise.all([first, waiter, late]);
    expect(peak).toBe(1);
    expect(semaphore.peak).toBe(1);
  });
});

describe('clientAddressKey', () => {
  it('groups IPv6 clients by /64 and keeps IPv4 as is', () => {
    expect(clientAddressKey('2001:db8:1:2:aaaa::1')).toBe(clientAddressKey('2001:db8:1:2:bbbb::9'));
    expect(clientAddressKey('2001:db8:1:3::1')).not.toBe(clientAddressKey('2001:db8:1:2::1'));
    expect(clientAddressKey('::ffff:10.0.0.7')).toBe('10.0.0.7');
    expect(clientAddressKey('10.0.0.7')).toBe('10.0.0.7');
    expect(clientAddressKey(undefined)).toBe('unknown');
  });
});
