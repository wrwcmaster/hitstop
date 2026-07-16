import { writeFileSync } from 'node:fs';

// Weapons need room beyond the knight's 35x63 body frame for long blades and
// full attack arcs. The player origin sits at the center of this larger sheet.
const W = 128;
const H = 128;
const BODY_CX = W / 2;
const BODY_BY = H / 2;
const TEXEL = 4;

const poses = {
  idle: [{ x: 1.75, y: -4.5, angle: -Math.PI / 6 }],
  run: [
    { x: 2.25, y: -5.25, angle: -Math.PI / 6 },
    { x: 1.75, y: -4.5, angle: -Math.PI / 6 },
    { x: 1.25, y: -5.25, angle: -Math.PI / 6 },
    { x: 1.75, y: -4.5, angle: -Math.PI / 6 },
  ],
  air: [{ x: 1.5, y: -5, angle: -Math.PI / 6 }],
  attack: Array.from({ length: 6 }, (_, i) => ({
    x: 1.75,
    y: -4.5,
    angle: -1.3 + 2.6 * (i / 5),
  })),
};

const specs = {
  'rusty-sword': {
    bladeLen: 7,
    bladeW: 1,
    palette: { B: '#bcd1ce', D: '#3f7299', H: '#d9a441', G: '#302426', W: '#ffffff' },
  },
  'great-sword': {
    bladeLen: 12,
    bladeW: 2.25,
    palette: { B: '#d9a441', D: '#6b3e45', H: '#bf5749', G: '#302426', W: '#ffffff' },
  },
};

function frameFor(pose, spec) {
  const rows = Array.from({ length: H }, () => Array(W).fill('.'));
  const put = (x, y, char) => {
    const col = Math.round(BODY_CX + x * TEXEL);
    const row = Math.round(BODY_BY + y * TEXEL);
    if (row >= 0 && row < H && col >= 0 && col < W) rows[row][col] = char;
  };
  const line = (x0, y0, x1, y1, char, width = 0.25) => {
    const distance = Math.hypot(x1 - x0, y1 - y0);
    const steps = Math.max(1, Math.ceil(distance * TEXEL * 2));
    const dx = (x1 - x0) / Math.max(distance, 0.001);
    const dy = (y1 - y0) / Math.max(distance, 0.001);
    const halfWidth = width / 2;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const x = x0 + (x1 - x0) * t;
      const y = y0 + (y1 - y0) * t;
      for (let offset = -halfWidth; offset <= halfWidth + 0.001; offset += 1 / TEXEL) {
        put(x - dy * offset, y + dx * offset, char);
      }
    }
  };

  const dx = Math.cos(pose.angle);
  const dy = Math.sin(pose.angle);
  const px = -dy;
  const py = dx;
  const hx = pose.x;
  const hy = pose.y;

  line(hx - dx * 2.2, hy - dy * 2.2, hx, hy, 'G', 0.5);
  put(hx - dx * 2.6, hy - dy * 2.6, 'H');
  const guard = spec.bladeW > 1 ? 2 : 1.4;
  line(hx - px * guard, hy - py * guard, hx + px * guard, hy + py * guard, 'H', 0.5);

  const tipX = hx + dx * spec.bladeLen;
  const tipY = hy + dy * spec.bladeLen;
  line(hx + dx * 0.5, hy + dy * 0.5, tipX, tipY, 'B', spec.bladeW);
  if (spec.bladeW > 1) {
    line(hx + dx, hy + dy, tipX - dx, tipY - dy, 'D');
    line(hx + dx + px * 0.75, hy + dy + py * 0.75, tipX - dx + px * 0.75, tipY - dy + py * 0.75, 'W');
  } else {
    line(hx + dx + px * 0.55, hy + dy + py * 0.55, tipX - dx + px * 0.55, tipY - dy + py * 0.55, 'W');
  }
  put(tipX, tipY, 'W');
  return rows.map((row) => row.join(''));
}

for (const [id, spec] of Object.entries(specs)) {
  const anims = {};
  for (const [name, frames] of Object.entries(poses)) {
    anims[name] = {
      fps: name === 'run' ? 10 : name === 'attack' ? 18 : name === 'idle' ? 2 : 1,
      loop: name === 'attack' ? false : undefined,
      frames: frames.map((pose) => frameFor(pose, spec)),
    };
    if (anims[name].loop === undefined) delete anims[name].loop;
  }
  // The generator already rasterizes at the engine's 4x texel density.
  const file = { hd: false, palette: spec.palette, anims };
  writeFileSync(`src/game/content/sprites/equipment/${id}.json`, `${JSON.stringify(file, null, 2)}\n`);
}
