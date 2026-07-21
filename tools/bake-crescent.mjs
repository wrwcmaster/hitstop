// Bakes the plunge crescent into an authored sprite sheet, using the same
// geometry the procedural trail computes (radius, angles, taper) so the
// art drops in without re-tuning the attack.
//
//   node tools/bake-crescent.mjs src/game/content/sprites/slash-crescent.json
//
// This is a STARTING POINT generator, not the source of truth. The output
// is ordinary sprite rows meant to be hand-edited from here on, so
// re-running it overwrites any hand-drawn work — regenerate only when you
// want to go back to the machine-baked shape.
import { writeFileSync } from 'node:fs';

const W = 26, H = 9;
const CX = 12.5, CY = -4.0;   // arc centre sits above the grid: the band curves below it
const R = 11, THICK = 4.4;
const A0 = 0.45, A1 = 2.69;  // matches the plunge trail's start/end angles

/** One frame at sweep fraction `s` (0..1 of the arc drawn so far). */
function frame(s) {
  const cur = A0 + (A1 - A0) * s;
  const rows = [];
  for (let y = 0; y < H; y++) {
    let row = '';
    for (let x = 0; x < W; x++) {
      const dx = x + 0.5 - CX;
      const dy = y + 0.5 - CY;
      const r = Math.hypot(dx, dy);
      const theta = Math.atan2(dy, dx);
      const span = cur - A0;
      if (theta < A0 || theta > cur || span <= 0.001) { row += '.'; continue; }
      const t = (theta - A0) / span;
      const half = (THICK * Math.sin(Math.PI * t) ** 1.3) / 2; // bias 0.5, sharpened tips
      const d = Math.abs(r - R);
      row += d > half + 0.02 ? '.' : d <= half * 0.45 ? 'W' : 'S';
    }
    rows.push(row);
  }
  return rows;
}

const frames = [0.22, 0.45, 0.68, 0.85, 1].map(frame);

for (const [i, f] of frames.entries()) {
  console.log(`--- frame ${i} ---`);
  console.log(f.join('\n'));
}

const out = { w: W, h: H, anims: { slash: { fps: 30, frames } } };
writeFileSync(process.argv[2], JSON.stringify(out, null, 2) + '\n');
