import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
  preview: { host: '127.0.0.1', port: 4173, strictPort: true },
  build: {
    target: 'es2023',
    // Phaser is loaded lazily in its own chunk (~1.4 MB minified).
    chunkSizeWarningLimit: 1500,
  },
});
