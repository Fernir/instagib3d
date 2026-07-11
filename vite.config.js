import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

const srcDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'src');

export default defineConfig({
  resolve: {
    alias: { '@': srcDir },
  },
  build: {
    target: 'es2020',
  },
  server: {
    port: 3000,
    proxy: {
      '/peerjs': {
        target: 'http://localhost:9000',
        ws: true,
        changeOrigin: true,
      },
    },
  },
  test: {
    environment: 'node',
    include: ['test/**/*.test.js'],
    globals: false,
  },
});
