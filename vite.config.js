import { defineConfig } from 'vite';

export default defineConfig({
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
});
