import { defineConfig, devices } from '@playwright/test';

const SERVER_PORT = 2567;
const WEB_PORT = 4173;

/**
 * Multiplayer gate against the production build: the bundled server (node
 * dist/main.js) and the built client served by `vite preview`. Run `pnpm build` first.
 */
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  workers: 1,
  fullyParallel: false,
  forbidOnly: Boolean(process.env['CI']),
  reporter: process.env['CI'] ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://127.0.0.1:${WEB_PORT}`,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'node apps/server/dist/main.js',
      port: SERVER_PORT,
      reuseExistingServer: false,
      env: {
        HOST: '127.0.0.1',
        PORT: String(SERVER_PORT),
        ALLOWED_ORIGINS: `http://127.0.0.1:${WEB_PORT}`,
      },
    },
    {
      command: 'pnpm --filter @orbit/web preview',
      port: WEB_PORT,
      reuseExistingServer: false,
    },
  ],
});
