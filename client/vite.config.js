import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true,
    proxy: {
      '/api': {
        target: process.env.VITE_API_TARGET || 'http://localhost:3888',
        changeOrigin: true,
        // The backend rejects cross-origin writes (originGuard); the dev proxy
        // is same-machine tooling, so drop the :5173 Origin it would forward.
        configure: (proxy) => proxy.on('proxyReq', (proxyReq) => proxyReq.removeHeader('origin')),
      },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
