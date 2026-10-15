import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/src/**/*.test.ts', 'apps/*/src/**/*.test.ts', 'apps/*/test/**/*.test.ts'],
    exclude: ['**/node_modules/**', 'packages/database/**'],
    // Integration tests run real servers in real time; running files one at a time
    // keeps tick timing assertions independent of machine load.
    fileParallelism: false,
    // Integration tests wait on real ticks and network round trips.
    testTimeout: 15_000,
  },
});
