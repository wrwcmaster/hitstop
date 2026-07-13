import { defineConfig } from 'vite';
import { resolve } from 'path';
import { readFileSync } from 'fs';
import { viteSingleFile } from 'vite-plugin-singlefile';

const pkg = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf-8'));

/**
 * Single-file build: the whole game compiled into one self-contained
 * HTML file (hitstop.html) that runs from a double-click — no server,
 * no assets, in the spirit of the original demo.html.
 *
 *   npm run build:single
 */
export default defineConfig({
  resolve: {
    alias: {
      '@engine': resolve(__dirname, 'src/engine'),
      '@game': resolve(__dirname, 'src/game'),
    },
  },
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  plugins: [viteSingleFile()],
  build: {
    outDir: 'dist-single',
    rollupOptions: {
      input: resolve(__dirname, 'index.html'),
    },
  },
});
