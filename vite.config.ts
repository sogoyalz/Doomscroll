import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { crx } from '@crxjs/vite-plugin';
import { fileURLToPath, URL } from 'node:url';
import manifest from './manifest.json';

export default defineConfig({
  plugins: [react(), crx({ manifest })],
  build: {
    // Vite emits <link rel="modulepreload" crossorigin> to warm up chunks.
    // The crossorigin attribute makes Chrome fetch them in CORS mode, but the
    // real import of a chrome-extension:// resource resolves in a different
    // mode, so the preloaded copy never matches and is discarded — Chrome logs
    // "cross-world extension resource mismatch" and the chunk is fetched twice.
    //
    // Preloading exists to hide network latency. Extension pages load from
    // local disk, so it buys nothing here and costs a duplicate request.
    modulePreload: false,
  },
  resolve: {
    alias: {
      '@shared': fileURLToPath(new URL('./src/shared', import.meta.url)),
    },
  },
  test: {
    // Most of this codebase reads Instagram's DOM, so jsdom is the useful
    // default. Note jsdom does not implement innerText — extractor.ts falls
    // back to textContent, which is the path these tests exercise.
    environment: 'jsdom',
  },
});
