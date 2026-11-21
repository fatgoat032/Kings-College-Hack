import { defineConfig } from 'vite';
import { resolve } from 'node:path';

const SERVER_PORT = Number(process.env.SERVER_PORT || 3000);

export default defineConfig({
  server: {
    host: true, // listen on the LAN so phones on the hotspot can reach it
    port: 5173,
    proxy: {
      '/socket.io': { target: `http://localhost:${SERVER_PORT}`, ws: true },
      '/api': `http://localhost:${SERVER_PORT}`,
    },
  },
  build: {
    rollupOptions: {
      input: {
        index: resolve(import.meta.dirname, 'index.html'),
        display: resolve(import.meta.dirname, 'display.html'),
        controller: resolve(import.meta.dirname, 'controller.html'),
        fakeDisplay: resolve(import.meta.dirname, 'src/net/fake-display.html'),
      },
    },
  },
});
