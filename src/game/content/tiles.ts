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

/** Doorway glow: non-solid, purely visual. Pair with a `door` trigger. */
tiles.register('gate', {
  draw(g, px, py, size) {
    g.fillStyle = 'rgba(59,93,201,0.25)';
    g.fillRect(px, py, size, size);
    g.fillStyle = 'rgba(148,176,194,0.5)';
    g.fillRect(px, py, 1, size);
    g.fillRect(px + size - 1, py, 1, size);
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

/** Deep water: swimmable, translucent, with drifting light motes. */
tiles.register('water', {
  water: true,
  draw(g, px, py, size, tx, ty) {
    g.fillStyle = 'rgba(38,84,164,0.55)';
    g.fillRect(px, py, size, size);
    // A sparse mote per some tiles, drifting on a per-tile phase.
    if ((tx * 7 + ty * 13) % 5 === 0) {
      const t = performance.now() / 1000 + tx * 1.7 + ty * 0.9;
      const mx = px + 2 + ((Math.sin(t) + 1) / 2) * (size - 4);
      const my = py + 2 + ((Math.cos(t * 0.7) + 1) / 2) * (size - 4);
      g.fillStyle = 'rgba(148,200,255,0.25)';
      g.fillRect(Math.round(mx), Math.round(my), 1, 1);
    }
  },
});

/** Water surface: swimmable, with an animated highlight lapping on top. */
tiles.register('waterTop', {
  water: true,
  draw(g, px, py, size, tx) {
    g.fillStyle = 'rgba(38,84,164,0.5)';
    g.fillRect(px, py, size, size);
    const t = performance.now() / 1000;
    // Two bright crests sliding across the surface row.
    const w1 = Math.round(((Math.sin(t * 1.6 + tx * 0.9) + 1) / 2) * (size - 2));
    g.fillStyle = 'rgba(180,220,255,0.65)';
    g.fillRect(px, py, size, 1);
    g.fillStyle = 'rgba(255,255,255,0.55)';
    g.fillRect(px + w1, py, 2, 1);
  },
});
