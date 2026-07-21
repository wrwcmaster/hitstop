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
/**
 * A barred door: banded timber filling a one-tile opening.
 *
 * Only LOCKED doorways carry this now. An open one is simply a gap in
 * the wall you walk through, so seeing a door at all means "this one
 * wants something from you" — the art is the lock, rather than
 * decoration every threshold happens to wear.
 *
 * Drawn to tile vertically down the opening: planks run the full height
 * and an iron band lands on every other row (`ty`), so a four-tall door
 * reads as one banded slab rather than four stacked panels.
 */
tiles.register('gate', {
  draw(g, px, py, size, _tx, ty) {
    g.fillStyle = COLORS.redDark;
    g.fillRect(px, py, size, size);
    // Plank seams.
    g.fillStyle = COLORS.outline;
    for (let i = 2; i < size; i += 3) g.fillRect(px + i, py, 1, size);
    // Frame down both jambs.
    g.fillStyle = COLORS.steelDark;
    g.fillRect(px, py, 1, size);
    g.fillRect(px + size - 1, py, 1, size);
    // Iron band every other row, with a rivet at each end.
    if (ty % 2 === 1) {
      g.fillRect(px, py + 2, size, 2);
      g.fillStyle = COLORS.steel;
      g.fillRect(px + 1, py + 2, 1, 1);
      g.fillRect(px + size - 2, py + 2, 1, 1);
    }
  },
});

/** Portal vortex: non-solid, purely visual. Pair with a `portal` trigger.
 * A swirling violet gate — deliberately unlike the blue rectangular door,
 * so a warp pad never reads as an ordinary locked gate. Magenta and cyan
 * flecks orbit each tile's centre on a shared phase, so the stacked column
 * reads as one turning whirlpool. */
tiles.register('portal', {
  draw(g, px, py, size, tx, ty) {
    const now = performance.now() / 1000;
    // Deep violet core wash.
    g.fillStyle = 'rgba(93,39,93,0.5)';
    g.fillRect(px, py, size, size);
    g.fillStyle = 'rgba(127,46,127,0.4)';
    g.fillRect(px + 1, py + 1, size - 2, size - 2);
    const cx = px + size / 2;
    const cy = py + size / 2;
    // Two orbiting sparks (magenta + cyan), swirling in and out.
    for (let k = 0; k < 2; k++) {
      const a = now * 2.4 + (tx + ty) * 0.7 + k * Math.PI;
      const r = 1 + ((Math.sin(now * 3 + k * 1.6) + 1) / 2) * (size / 2 - 0.5);
      const sx = Math.round(cx + Math.cos(a) * r);
      const sy = Math.round(cy + Math.sin(a) * r);
      g.fillStyle = k === 0 ? 'rgba(233,110,233,0.9)' : 'rgba(115,205,255,0.85)';
      g.fillRect(sx, sy, 1, 1);
    }
    // A bright core mote that bobs, the eye of the whirl.
    g.fillStyle = 'rgba(255,224,255,0.65)';
    g.fillRect(Math.round(cx - 0.5), Math.round(cy - 0.5 + Math.sin(now * 4 + ty) * 1.2), 1, 1);
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

/** Floor spikes: non-solid, but standing in them costs a heart. */
tiles.register('spikes', {
  hazard: 20,
  draw(g, px, py, size, tx) {
    // A row of steel points on a dark base, alternating heights per tile.
    g.fillStyle = COLORS.navyDark;
    g.fillRect(px, py + size - 2, size, 2);
    g.fillStyle = COLORS.steel;
    const tall = tx % 2 === 0;
    for (let i = 0; i < size; i += 4) {
      const h = tall && i % 8 === 0 ? size - 1 : size - 4;
      g.beginPath();
      g.moveTo(px + i, py + size);
      g.lineTo(px + i + 2, py + size - h);
      g.lineTo(px + i + 4, py + size);
      g.fill();
    }
    g.fillStyle = COLORS.white;
    for (let i = 0; i < size; i += 8) g.fillRect(px + i + 1, py + 3, 1, 1);
  },
});
