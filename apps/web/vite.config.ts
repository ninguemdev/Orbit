import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

const ROOT = '../..';

export default defineConfig(({ mode }) => {
  // VITE_SERVER_URL is documented in the repository root .env/.env.example.
  const env = loadEnv(mode, ROOT, 'VITE_');
  // `||`: an empty VITE_SERVER_URL= in .env also falls back to the local server.
  const server = env['VITE_SERVER_URL'] || 'http://127.0.0.1:2567';
  // The account API is served under the page's own origin, so the session cookie is
  // first-party, as it will be behind the production reverse proxy.
  const proxy = { '/api': { target: server, changeOrigin: false } };
  return {
    plugins: [react()],
    envDir: ROOT,
    server: { host: '127.0.0.1', port: 5173, strictPort: true, proxy },
    preview: { host: '127.0.0.1', port: 4173, strictPort: true, proxy },
    build: {
      target: 'es2023',
      // Phaser is loaded lazily in its own chunk (~1.4 MB minified).
      chunkSizeWarningLimit: 1500,
    },
  };
});
