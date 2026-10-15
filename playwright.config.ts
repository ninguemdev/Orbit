import { defineConfig, devices } from '@playwright/test';

// The game server needs DATABASE_URL (accounts); CI sets it, locally it comes from .env.
try {
  process.loadEnvFile('.env');
} catch {
  // Already in the environment.
}

/** The client connects to this port; a drop proxy forwards it to the game server. */
const PUBLIC_SERVER_PORT = 2567;
const SERVER_PORT = 2568;
const PROXY_CONTROL_PORT = 2569;
const WEB_PORT = 4173;

/**
 * Multiplayer gate against the production build: the bundled server (node
 * dist/main.js) and the built client served by `vite preview`. Run `pnpm build` first.
 * A TCP proxy in front of the server lets tests simulate network drops.
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
        DATABASE_URL: process.env['DATABASE_URL'] ?? '',
        // Every test signs up fresh accounts from the same address.
        SIGNUPS_PER_ADDRESS: '1000',
        LOGIN_ATTEMPTS_PER_ADDRESS: '1000',
        PARTY_CODE_GUESSES_PER_ADDRESS: '1000',
      },
    },
    {
      command: 'node tests/e2e/support/drop-proxy.mjs',
      port: PUBLIC_SERVER_PORT,
      reuseExistingServer: false,
      env: {
        PROXY_PORT: String(PUBLIC_SERVER_PORT),
        TARGET_PORT: String(SERVER_PORT),
        CONTROL_PORT: String(PROXY_CONTROL_PORT),
      },
    },
    {
      command: 'pnpm --filter @orbit/web preview',
      port: WEB_PORT,
      reuseExistingServer: false,
    },
  ],
});
