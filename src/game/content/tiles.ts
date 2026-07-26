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
  traits: ['resonant'],
  draw(g, px, py, size) {
    drawRock(g, px, py, size);
  },
});

/** Solid rock with a grass lip — use for the exposed top row of ground. */
tiles.register('rockTop', {
  solid: true,
  traits: ['resonant', 'rebound'],
  draw(g, px, py, size) {
    drawRock(g, px, py, size);
    g.fillStyle = COLORS.green;
    g.fillRect(px, py, size, 3);
    g.fillStyle = COLORS.greenDark;
    g.fillRect(px, py + 3, size, 1);
  },
});

/** Weak stone: a real content-defined Impact Drop candidate. The engine
 * exposes its labels but does not know what breaking or resonance means. */
tiles.register('crackedRock', {
  solid: true,
  traits: ['breakable', 'resonant', 'rebound'],
  draw(g, px, py, size, tx, ty) {
    drawRock(g, px, py, size);
    g.fillStyle = COLORS.steel;
    const flip = (tx + ty) % 2;
    g.fillRect(px + 3 + flip, py, 1, 3);
    g.fillRect(px + 2 + flip, py + 3, 2, 1);
    g.fillRect(px + 2, py + 4, 1, 2);
    g.fillRect(px + 1, py + 6, 2, 1);
    g.fillStyle = COLORS.gold;
    g.fillRect(px + 3 + flip, py, 1, 1);
  },
});

function alpineNoise(tx: number, ty: number, salt: number): number {
  const n = Math.sin(tx * 91.7 + ty * 47.3 + salt * 113.1) * 43758.5453;
  return n - Math.floor(n);
}

/** Cold, fractured cliff stone used by the exposed mountain pass. */
function drawAlpineRock(
  g: CanvasRenderingContext2D,
  px: number,
  py: number,
  size: number,
  tx: number,
  ty: number,
): void {
  g.fillStyle = '#24344a';
  g.fillRect(px, py, size, size);
  g.fillStyle = '#18263a';
  const seam = 2 + Math.floor(alpineNoise(tx, ty, 1) * (size - 3));
  g.fillRect(px + seam, py, 1, 3);
  g.fillRect(px + Math.max(1, seam - 2), py + 3, 3, 1);
  if (alpineNoise(tx, ty, 2) > 0.48) g.fillRect(px + 1, py + size - 2, 3, 1);
  g.fillStyle = '#3d5669';
  g.fillRect(px + 1 + Math.floor(alpineNoise(tx, ty, 3) * (size - 3)), py + 1, 2, 1);
}

tiles.register('alpineRock', {
  solid: true,
  traits: ['resonant'],
  draw(g, px, py, size, tx, ty) {
    drawAlpineRock(g, px, py, size, tx, ty);
  },
});

tiles.register('alpineRockTop', {
  solid: true,
  traits: ['resonant', 'rebound'],
  draw(g, px, py, size, tx, ty) {
    drawAlpineRock(g, px, py, size, tx, ty);
    // Broken snow cap: pale blue shadow under a wind-bright lip.
    g.fillStyle = '#b8d6d5';
    g.fillRect(px, py, size, 2);
    g.fillStyle = '#e8f2ef';
    g.fillRect(px, py, size - (tx % 3 === 0 ? 2 : 0), 1);
    if ((tx + ty) % 4 === 0) g.fillRect(px + 1, py + 2, 2, 1);
  },
});

/** A narrow natural shelf: jump-through stone with snow and small icicles. */
tiles.register('alpineLedge', {
  oneWay: true,
  traits: ['rebound'],
  draw(g, px, py, size, tx) {
    g.fillStyle = '#e8f2ef';
    g.fillRect(px, py, size, 1);
    g.fillStyle = '#9bbfc2';
    g.fillRect(px, py + 1, size, 2);
    g.fillStyle = '#334b60';
    g.fillRect(px + 1, py + 3, size - 2, 3);
    g.fillStyle = '#1b2a3e';
    g.fillRect(px + 2, py + 6, size - 4, 2);
    if (tx % 3 === 1) {
      g.fillStyle = '#86aeb5';
      g.fillRect(px + size - 2, py + 6, 1, 2);
    }
  },
});

/* ---------------- the Riven: a crack in the world's frame ----------------
 *
 * The region's whole grammar is READING A WALL. Three stones say three
 * different things at a glance, and the difference is mechanical, not
 * decorative: `rivenRock` is the cold body of the crack, `gripstone`
 * wears visible holds and is what a climb is made of, and `slickPanel`
 * is polished blue glass that hands slide off — it carries the `slick`
 * trait, which is what Wall Grip refuses (see Player.grippableSide).
 * A shaft is therefore legible from below, like a route on a crag.
 */

function drawRivenStone(g: CanvasRenderingContext2D, px: number, py: number, size: number, tx: number, ty: number): void {
  g.fillStyle = '#22304f';
  g.fillRect(px, py, size, size);
  g.fillStyle = '#1a2540';
  const n = (tx * 7 + ty * 13) % 5;
  g.fillRect(px + n, py + ((tx + ty) % 4), 3, 1);
  g.fillRect(px + (n + 4) % (size - 2), py + 5 + (ty % 3), 2, 1);
  g.fillStyle = '#2c3d63';
  g.fillRect(px + (tx * 3 + ty) % (size - 1), py + (ty * 5) % (size - 1), 1, 2);
}

/** The cold body of the crack: solid, rings, offers nothing to hold. */
tiles.register('rivenRock', {
  solid: true,
  traits: ['resonant'],
  draw: drawRivenStone,
});

/** Grip-worthy stone: fractured with visible holds. The climb is made of
 * this, and it is drawn so you can pick it out of a wall from below. */
tiles.register('gripstone', {
  solid: true,
  traits: ['resonant', 'grip'],
  draw(g, px, py, size, tx, ty) {
    drawRivenStone(g, px, py, size, tx, ty);
    // Ledges and cracks — the holds themselves, staggered per tile.
    g.fillStyle = '#5b7fa8';
    const off = (tx + ty) % 3;
    g.fillRect(px + 1, py + 3 + off, size - 4, 2);
    g.fillRect(px + 3, py + size - 4 - off, size - 5, 1);
    g.fillStyle = '#8fb6d6';
    g.fillRect(px + 1, py + 3 + off, size - 4, 1);
    g.fillRect(px + 3, py + size - 4 - off, 2, 1);
  },
});

/** Polished panel: solid and ordinary in every way EXCEPT that hands
 * slide off it. Interrupts climbs and forces kick-transfers. */
tiles.register('slickPanel', {
  solid: true,
  traits: ['resonant', 'slick'],
  draw(g, px, py, size, tx, ty) {
    g.fillStyle = '#2f4a72';
    g.fillRect(px, py, size, size);
    g.fillStyle = '#3d608f';
    g.fillRect(px, py, size, 1);
    g.fillRect(px, py, 1, size);
    // A wet sheen running the panel: the visual promise of no purchase.
    g.fillStyle = 'rgba(190,225,255,0.32)';
    const band = (tx * 5 + ty * 3) % size;
    g.fillRect(px + band, py, 2, size);
    g.fillStyle = 'rgba(230,245,255,0.5)';
    g.fillRect(px + band, py, 1, size);
    g.fillStyle = '#233a5c';
    g.fillRect(px, py + size - 1, size, 1);
  },
});

/** Hanging chain: pure atmosphere, no collision — the Riven's ceiling
 * is strung with the machinery that once worked this crack. */
tiles.register('chain', {
  draw(g, px, py, size, tx) {
    const cx = px + size / 2 + ((tx % 3) - 1);
    g.fillStyle = '#3f5170';
    g.fillRect(cx - 1, py, 2, size);
    g.fillStyle = '#6d86a8';
    for (let y = 0; y < size; y += 4) g.fillRect(cx - 1, py + y, 2, 1);
  },
});

/** Non-solid windswept grass/snow tuft, used as a readable ledge accent. */
tiles.register('snowTuft', {
  draw(g, px, py, size, tx) {
    g.fillStyle = '#86aeb5';
    g.fillRect(px + 1, py + size - 2, size - 2, 2);
    g.fillStyle = '#d8e9e6';
    g.fillRect(px + 2, py + size - 4, 1, 3);
    g.fillRect(px + 4, py + size - 5 - (tx % 2), 1, 4 + (tx % 2));
    g.fillRect(px + 6, py + size - 3, 1, 2);
  },
});

/** A tiny trail cairn: an environmental landmark, not a collision block. */
tiles.register('cairn', {
  draw(g, px, py, size) {
    g.fillStyle = '#18263a';
    g.fillRect(px + 1, py + 6, 7, 2);
    g.fillStyle = '#3d5669';
    g.fillRect(px + 2, py + 4, 5, 2);
    g.fillStyle = '#587286';
    g.fillRect(px + 3, py + 2, 3, 2);
    g.fillStyle = '#b8d6d5';
    g.fillRect(px + 3, py + 2, 2, 1);
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

/**
 * An open doorway: a timber-framed passage standing open, non-solid.
 *
 * Where `gate` says "barred, wants a key", this says "a way through is
 * here" — a stone jamb down each side framing a warm timber door with
 * plank seams, so an interior connection (underground ↔ vault) reads as a
 * real door rather than a bare gap in the rock. Position-independent, so it
 * tiles cleanly down a multi-row opening the way the gate does.
 */
tiles.register('doorway', {
  draw(g, px, py, size) {
    // Recessed dark opening with a warm timber interior.
    g.fillStyle = COLORS.bgDark;
    g.fillRect(px, py, size, size);
    g.fillStyle = COLORS.redDark;
    g.fillRect(px + 2, py, size - 4, size);
    // Plank seams down the door.
    g.fillStyle = COLORS.outline;
    for (let i = 3; i < size - 1; i += 3) g.fillRect(px + i, py, 1, size);
    // Stone jambs down both sides.
    g.fillStyle = COLORS.steelDark;
    g.fillRect(px, py, 2, size);
    g.fillRect(px + size - 2, py, 2, size);
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
  traits: ['rebound'],
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
