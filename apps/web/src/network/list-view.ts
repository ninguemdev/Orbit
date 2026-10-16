import type { ListView } from '@orbit/contracts';

/** Copies a synchronized list into a plain array, optionally mapping each item. */
export function copyList<T, U = T>(
  list: ListView<T> | undefined,
  map: (item: T) => U = (item) => item as unknown as U,
): U[] {
  const result: U[] = [];
  list?.forEach((item) => result.push(map(item)));
  return result;
}
