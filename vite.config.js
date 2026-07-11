import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const srcDir = path.resolve(rootDir, 'src');

export default defineConfig({
  resolve: {
    alias: {
      '@core': path.resolve(srcDir, 'core'),
      '@engine': path.resolve(srcDir, 'engine'),
      '@game': path.resolve(srcDir, 'game'),
      '@client': path.resolve(srcDir, 'client'),
      '@combat': path.resolve(srcDir, 'combat'),
      '@entity': path.resolve(srcDir, 'entity'),
      '@level': path.resolve(srcDir, 'level'),
      '@network': path.resolve(srcDir, 'network'),
      '@server': path.resolve(srcDir, 'server'),
    },
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
