import { defineConfig } from 'vitest/config';

// Database integration tests need PostgreSQL (`pnpm db:up`) and DATABASE_URL.
try {
  process.loadEnvFile('.env');
} catch {
  // CI provides DATABASE_URL directly.
}

export default defineConfig({
  test: {
    include: ['packages/database/test/**/*.test.ts'],
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
});
