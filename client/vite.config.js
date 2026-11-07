import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { execSync } from 'node:child_process';

// Shown in Settings → About, so a local build can be told apart from the release of the same
// version. BUILD_COMMIT comes from the Docker build (no .git in its context); otherwise ask git.
function buildCommit() {
  if (process.env.BUILD_COMMIT) return process.env.BUILD_COMMIT.slice(0, 7);
  const git = (args) => execSync(`git ${args}`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  try {
    const sha = git('rev-parse --short=7 HEAD');
    return git('status --porcelain --untracked-files=no') ? `${sha}-dirty` : sha;
  } catch {
    return null;
  }
}

export default defineConfig({
  plugins: [react()],
  define: {
    __BUILD_COMMIT__: JSON.stringify(buildCommit()),
    __BUILD_DATE__: JSON.stringify(new Date().toISOString().slice(0, 10)),
  },
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
