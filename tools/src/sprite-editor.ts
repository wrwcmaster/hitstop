import { sprite, type Palette } from '@engine/index';
import { PAL } from '@game/content/palette';

/**
 * Sprite editor for the engine's text-grid pixel art format.
 *
 * Paint on a zoomed grid using palette characters (seeded with the game's
 * shared palette, extensible with custom colors), manage animation frames,
 * watch a live preview, then export rows+palette ready to paste into a
 * content file (or feed to sprite()).
 */

const CELL = 24;

/* ---------------- state ---------------- */

let palette: Palette = { ...PAL };
let currentChar = 'S';
let frames: string[][] = [emptyFrame(12, 14)];
let frameIdx = 0;
let painting = false;
let erasing = false;

function emptyFrame(w: number, h: number): string[] {
  return Array.from({ length: h }, () => '.'.repeat(w));
}

const cur = () => frames[frameIdx];
const W = () => cur()[0].length;
const H = () => cur().length;

/* ---------------- dom ---------------- */

const $ = (id: string) => document.getElementById(id)!;
const grid = $('grid') as HTMLCanvasElement;
const gctx = grid.getContext('2d')!;
const preview = $('preview') as HTMLCanvasElement;
const pctx = preview.getContext('2d')!;

function flash(msg: string): void {
  const s = $('status');
  s.textContent = msg;
  setTimeout(() => {
    if (s.textContent === msg) s.textContent = '';
  }, 2000);
}

/* ---------------- palette ui ---------------- */

function buildPalette(): void {
  const host = $('palette');
  host.innerHTML = '';
  for (const [ch, color] of Object.entries(palette)) {
    const row = document.createElement('div');
    row.className = 'swatch';
    const chip = document.createElement('span');
    chip.className = 'chip' + (color ? '' : ' none');
    if (color) chip.style.background = color;
    const b = document.createElement('button');
    b.textContent = `${ch} ${color ?? '(erase)'}`;
    b.className = ch === currentChar ? 'active' : '';
    b.onclick = () => {
      currentChar = ch;
      buildPalette();
    };
    row.appendChild(chip);
    row.appendChild(b);
    host.appendChild(row);
  }
}

$('btnAddColor').onclick = () => {
  const ch = ($('newChar') as HTMLInputElement).value || '?';
  const color = ($('newColor') as HTMLInputElement).value;
  palette[ch] = color;
  currentChar = ch;
  buildPalette();
  redraw();
};

/* ---------------- editing ---------------- */

function setPixel(x: number, y: number, ch: string): void {
  if (x < 0 || y < 0 || x >= W() || y >= H()) return;
  const f = cur();
  f[y] = f[y].slice(0, x) + ch + f[y].slice(x + 1);
}

grid.addEventListener('contextmenu', (e) => e.preventDefault());
grid.addEventListener('mousedown', (e) => {
  erasing = e.button === 2;
  painting = true;
  paint(e);
});
grid.addEventListener('mousemove', (e) => {
  if (painting) paint(e);
});
window.addEventListener('mouseup', () => {
  painting = false;
  syncIO();
});

function paint(e: MouseEvent): void {
  const r = grid.getBoundingClientRect();
  const x = Math.floor((e.clientX - r.left) / CELL);
  const y = Math.floor((e.clientY - r.top) / CELL);
  setPixel(x, y, erasing ? '.' : currentChar);
  redraw();
}

/* ---------------- frames ---------------- */

function buildFrames(): void {
  const host = $('frames');
  host.innerHTML = '';
  frames.forEach((_, i) => {
    const b = document.createElement('button');
    b.textContent = String(i + 1);
    b.className = i === frameIdx ? 'active' : '';
    b.onclick = () => {
      frameIdx = i;
      buildFrames();
      redraw();
    };
    host.appendChild(b);
  });
}

$('btnAddFrame').onclick = () => {
  frames.push(emptyFrame(W(), H()));
  frameIdx = frames.length - 1;
  buildFrames();
  redraw();
};
$('btnDupFrame').onclick = () => {
  frames.splice(frameIdx + 1, 0, [...cur()]);
  frameIdx++;
  buildFrames();
  redraw();
};
$('btnDelFrame').onclick = () => {
  if (frames.length <= 1) return;
  frames.splice(frameIdx, 1);
  frameIdx = Math.min(frameIdx, frames.length - 1);
  buildFrames();
  redraw();
};

$('btnResize').onclick = () => {
  const w = Number(($('w') as HTMLInputElement).value);
  const h = Number(($('h') as HTMLInputElement).value);
  if (!(w >= 1 && h >= 1 && w <= 64 && h <= 64)) return;
  frames = frames.map((f) => {
    const next: string[] = [];
    for (let y = 0; y < h; y++) next.push((f[y] ?? '').slice(0, w).padEnd(w, '.'));
    return next;
  });
  redraw();
  syncIO();
};

/* ---------------- rendering ---------------- */

function redraw(): void {
  grid.width = W() * CELL;
  grid.height = H() * CELL;
  gctx.imageSmoothingEnabled = false;
  // Checkerboard for transparency.
  for (let y = 0; y < H(); y++) {
    for (let x = 0; x < W(); x++) {
      gctx.fillStyle = (x + y) % 2 ? '#141830' : '#0f1226';
      gctx.fillRect(x * CELL, y * CELL, CELL, CELL);
      const ch = cur()[y][x];
      const color = palette[ch];
      if (color) {
        gctx.fillStyle = color;
        gctx.fillRect(x * CELL, y * CELL, CELL, CELL);
      }
    }
  }
  gctx.strokeStyle = 'rgba(148,176,194,0.15)';
  for (let x = 0; x <= W(); x++) {
    gctx.beginPath();
    gctx.moveTo(x * CELL + 0.5, 0);
    gctx.lineTo(x * CELL + 0.5, H() * CELL);
    gctx.stroke();
  }
  for (let y = 0; y <= H(); y++) {
    gctx.beginPath();
    gctx.moveTo(0, y * CELL + 0.5);
    gctx.lineTo(W() * CELL, y * CELL + 0.5);
    gctx.stroke();
  }
}

/** Animated preview at 1x, 2x, 4x. */
function renderPreview(): void {
  const fps = Number(($('fps') as HTMLInputElement).value) || 8;
  const t = performance.now() / 1000;
  const idx = Math.floor(t * fps) % frames.length;
  const img = sprite(frames[idx], palette);
  pctx.imageSmoothingEnabled = false;
  pctx.clearRect(0, 0, preview.width, preview.height);
  let x = 8;
  for (const scale of [1, 2, 4]) {
    pctx.save();
    pctx.translate(x, 8);
    pctx.scale(scale, scale);
    pctx.drawImage(img, 0, 0);
    pctx.restore();
    x += img.width * scale + 10;
  }
  requestAnimationFrame(renderPreview);
}

/* ---------------- io ---------------- */

interface SpriteFile {
  palette: Palette;
  frames: string[][];
  fps: number;
}

function syncIO(): void {
  const data: SpriteFile = {
    palette,
    frames,
    fps: Number(($('fps') as HTMLInputElement).value) || 8,
  };
  ($('io') as HTMLTextAreaElement).value = JSON.stringify(data, null, 1);
}

$('btnExport').onclick = () => {
  syncIO();
  navigator.clipboard?.writeText(($('io') as HTMLTextAreaElement).value);
  flash('copied to clipboard');
};

$('btnImport').onclick = () => {
  try {
    const data = JSON.parse(($('io') as HTMLTextAreaElement).value) as SpriteFile;
    if (!Array.isArray(data.frames) || !data.frames.length) throw new Error('missing frames');
    palette = data.palette ?? palette;
    frames = data.frames;
    frameIdx = 0;
    if (data.fps) ($('fps') as HTMLInputElement).value = String(data.fps);
    ($('w') as HTMLInputElement).value = String(W());
    ($('h') as HTMLInputElement).value = String(H());
    buildPalette();
    buildFrames();
    redraw();
    flash('imported');
  } catch (err) {
    flash(`import failed: ${(err as Error).message}`);
  }
};

/* ---------------- boot ---------------- */

buildPalette();
buildFrames();
redraw();
syncIO();
renderPreview();
