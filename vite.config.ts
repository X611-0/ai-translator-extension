import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { crx } from '@crxjs/vite-plugin';
import manifest from './manifest.json';

export default defineConfig({
  base: './',
  plugins: [
    react(),
    crx({ manifest }),
  ],
  resolve: {
    alias: {
      '@': process.cwd() + '/src',
    },
  },
  build: {
    // 禁用 modulepreload polyfill（service worker 没有 document）
    modulePreload: {
      polyfill: false,
    },
    rollupOptions: {
      input: {
        popup: process.cwd() + '/src/popup/index.html',
        options: process.cwd() + '/src/options/index.html',
        offscreen: process.cwd() + '/src/background/offscreen.html',
      },
    },
  },
});
