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
    rollupOptions: {
      input: {
        popup: process.cwd() + '/src/popup/index.html',
        options: process.cwd() + '/src/options/index.html',
      },
    },
  },
});
