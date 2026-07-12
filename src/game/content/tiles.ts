import { tiles, offscreen } from '@engine/index';
import { COLORS } from './palette';

/**
 * Tile types used by rooms. Register new ones here and reference them
 * from room legends (the level editor lists whatever is registered).
 */

// Pre-baked noisy rock pattern, sampled per-tile for cheap variation.
const rockTile = (() => {
  const [c, g] = offscreen(16, 16);
  g.fillStyle = COLORS.navy;
  g.fillRect(0, 0, 16, 16);
  g.fillStyle = COLORS.navyDark;
  for (let i = 0; i < 10; i++) g.fillRect(Math.floor(Math.random() * 15), Math.floor(Math.random() * 15), 2, 1);
  g.fillStyle = COLORS.navyLight;
  for (let i = 0; i < 6; i++) g.fillRect(Math.floor(Math.random() * 15), Math.floor(Math.random() * 15), 1, 1);
  return c;
})();

function drawRock(g: CanvasRenderingContext2D, px: number, py: number, size: number): void {
  // Sample a shifting window of the 16x16 pattern so adjacent tiles differ.
  const sx = px % Math.max(1, 16 - size);
  const sy = py % Math.max(1, 16 - size);
  g.drawImage(rockTile, sx, sy, size, size, px, py, size, size);
}

/** Solid rock, used below the surface. */
tiles.register('rock', {
  solid: true,
  draw(g, px, py, size) {
    drawRock(g, px, py, size);
  },
});

/** Solid rock with a grass lip — use for the exposed top row of ground. */
tiles.register('rockTop', {
  solid: true,
  draw(g, px, py, size) {
    drawRock(g, px, py, size);
    g.fillStyle = COLORS.green;
    g.fillRect(px, py, size, 3);
    g.fillStyle = COLORS.greenDark;
    g.fillRect(px, py + 3, size, 1);
  },
});

/** One-way platform: jump through from below, stand on top. */
tiles.register('platform', {
  oneWay: true,
  draw(g, px, py, size) {
    g.fillStyle = COLORS.navyLight;
    g.fillRect(px, py, size, size);
    g.fillStyle = COLORS.steelDark;
    g.fillRect(px, py, size, 2);
    g.fillStyle = COLORS.navyDark;
    g.fillRect(px, py + size - 2, size, 2);
  },
});
