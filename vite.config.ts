import { defineConfig } from 'vite';
import { resolve } from 'path';
import { readFileSync } from 'fs';

const pkg = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf-8'));

// Multi-page app: the game plus each design tool is its own entry point.
export default defineConfig({
  // Relative asset URLs so the build runs from any path — a double-click,
  // a project GitHub Pages subpath (wrwcmaster.github.io/hitstop/), or a
  // custom domain — without hardcoding the repo name.
  base: './',
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
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
        'sheet-slicer': resolve(__dirname, 'tools/sheet-slicer.html'),
      },
    },
  },
  server: {
    host: true,
  },
});
