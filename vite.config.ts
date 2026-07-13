import { defineConfig } from 'vite';
import { resolve } from 'path';

// Multi-page app: the game plus each design tool is its own entry point.
export default defineConfig({
  // Relative asset URLs so the build runs from any path — a double-click,
  // a project GitHub Pages subpath (wrwcmaster.github.io/hitstop/), or a
  // custom domain — without hardcoding the repo name.
  base: './',
  resolve: {
    alias: {
      '@engine': resolve(__dirname, 'src/engine'),
      '@game': resolve(__dirname, 'src/game'),
    },
  },
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        'level-editor': resolve(__dirname, 'tools/level-editor.html'),
        'sprite-editor': resolve(__dirname, 'tools/sprite-editor.html'),
      },
    },
  },
  server: {
    host: true,
  },
});
