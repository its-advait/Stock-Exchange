import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const API = process.env.AEZ_API_URL ?? 'http://localhost:4000';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
    // Resolve @aez/shared to its TypeScript source (see packages/shared/package.json "source" export).
    conditions: ['source'],
  },
  server: {
    port: 5173,
    strictPort: true,
    // Same-origin in development: the session cookie and Socket.IO handshake go through the proxy.
    proxy: {
      '/api': { target: API },
      '/socket.io': { target: API, ws: true },
    },
  },
  preview: {
    port: 5173,
    proxy: {
      '/api': { target: API },
      '/socket.io': { target: API, ws: true },
    },
  },
  build: {
    chunkSizeWarningLimit: 700,
    rolldownOptions: {
      output: {
        advancedChunks: {
          groups: [
            { name: 'react', test: /node_modules[\\/](react|react-dom|react-router|scheduler)[\\/]/ },
            { name: 'charts', test: /node_modules[\\/](lightweight-charts|fancy-canvas)[\\/]/ },
            { name: 'vendor', test: /node_modules[\\/]/ },
          ],
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
