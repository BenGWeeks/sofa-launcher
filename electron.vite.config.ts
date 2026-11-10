import { resolve } from 'node:path';
import { defineConfig } from 'electron-vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  main: { resolve: { alias: { '@shared': resolve('src/shared') } } },
  preload: {
    resolve: { alias: { '@shared': resolve('src/shared') } },
    // Two preloads: the full API for the launcher + panel, a toast-only one for the toast window.
    build: { rolldownOptions: { input: { index: resolve('src/preload/index.ts'), toast: resolve('src/preload/toast.ts'), camera: resolve('src/preload/camera.ts') } } },
  },
  renderer: {
    resolve: { alias: { '@shared': resolve('src/shared') } },
    plugins: [svelte()],
  },
});
