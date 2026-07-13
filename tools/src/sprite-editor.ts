import { sprite, epx, type Palette, type SpriteFile } from '@engine/index';
import { PAL } from '@game/content/palette';

/**
 * Sprite editor for the engine's per-sprite JSON format
 * (content/sprites/*.json): a palette plus named animations of 1x text
 * grids. Paint on a zoomed grid, manage animations and their frames, watch
 * every animation play at once (optionally EPX-upscaled to the game's 4x
 * "hd" density), then export/import the exact file the game loads.
 */

const CELL = 24;

/* ---------------- state ---------------- */

let file: SpriteFile = {
  hd: true,
  palette: { ...PAL },
  anims: { idle: { fps: 8, frames: [emptyFrame(12, 14)] } },
};
let animName = 'idle';
let frameIdx = 0;
let currentChar = firstPaintChar();
let painting = false;
let erasing = false;

function emptyFrame(w: number, h: number): string[] {
  return Array.from({ length: h }, () => '.'.repeat(w));
}
function firstPaintChar(): string {
  const entry = Object.entries(file.palette ?? {}).find(([, c]) => c);
  return entry ? entry[0] : 'S';
}

const pal = (): Palette => file.palette ?? {};
const anim = () => file.anims[animName];
const cur = () => anim().frames[frameIdx];
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
  for (const [ch, color] of Object.entries(pal())) {
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
  (file.palette ??= {})[ch] = color;
  currentChar = ch;
  buildPalette();
  redraw();
};

/* ---------------- animations ui ---------------- */

function buildAnims(): void {
  const host = $('anims');
  host.innerHTML = '';
  for (const name of Object.keys(file.anims)) {
    const b = document.createElement('button');
    b.textContent = name;
    b.className = name === animName ? 'active' : '';
    b.style.marginRight = '4px';
    b.onclick = () => {
      animName = name;
      frameIdx = 0;
      refreshUI();
    };
    host.appendChild(b);
  }
  ($('fps') as HTMLInputElement).value = String(anim().fps);
}

$('btnAddAnim').onclick = () => {
  const name = prompt('animation name (e.g. idle, run, air):', '')?.trim();
  if (!name) return;
  if (file.anims[name]) {
    flash('already exists');
    return;
  }
  file.anims[name] = { fps: 8, frames: [emptyFrame(W(), H())] };
  animName = name;
  frameIdx = 0;
  refreshUI();
};
$('btnRenameAnim').onclick = () => {
  const name = prompt('rename animation:', animName)?.trim();
  if (!name || name === animName) return;
  if (file.anims[name]) {
    flash('already exists');
    return;
  }
  // Rebuild in order, swapping the key so button order is stable.
  const next: SpriteFile['anims'] = {};
  for (const [k, v] of Object.entries(file.anims)) next[k === animName ? name : k] = v;
  file.anims = next;
  animName = name;
  refreshUI();
};
$('btnDelAnim').onclick = () => {
  const names = Object.keys(file.anims);
  if (names.length <= 1) {
    flash('need at least one');
    return;
  }
  delete file.anims[animName];
  animName = Object.keys(file.anims)[0];
  frameIdx = 0;
  refreshUI();
};
($('fps') as HTMLInputElement).onchange = (e) => {
  anim().fps = Number((e.target as HTMLInputElement).value) || 1;
  syncIO();
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
  // Only re-serialize after an actual paint stroke — otherwise clicking a
  // button (e.g. Import) would clobber whatever's in the textarea before
  // its handler could read it.
  if (painting) {
    painting = false;
    syncIO();
  }
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
  anim().frames.forEach((_, i) => {
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
  $('frameOf').textContent = `${animName} · ${frameIdx + 1}/${anim().frames.length}`;
}

$('btnAddFrame').onclick = () => {
  anim().frames.push(emptyFrame(W(), H()));
  frameIdx = anim().frames.length - 1;
  buildFrames();
  redraw();
  syncIO();
};
$('btnDupFrame').onclick = () => {
  anim().frames.splice(frameIdx + 1, 0, [...cur()]);
  frameIdx++;
  buildFrames();
  redraw();
  syncIO();
};
$('btnDelFrame').onclick = () => {
  if (anim().frames.length <= 1) return;
  anim().frames.splice(frameIdx, 1);
  frameIdx = Math.min(frameIdx, anim().frames.length - 1);
  buildFrames();
  redraw();
  syncIO();
};

$('btnResize').onclick = () => {
  const w = Number(($('w') as HTMLInputElement).value);
  const h = Number(($('h') as HTMLInputElement).value);
  if (!(w >= 1 && h >= 1 && w <= 64 && h <= 64)) return;
  // Resize every frame of every animation so the sprite stays uniform.
  for (const a of Object.values(file.anims)) {
    a.frames = a.frames.map((f) => {
      const next: string[] = [];
      for (let y = 0; y < h; y++) next.push((f[y] ?? '').slice(0, w).padEnd(w, '.'));
      return next;
    });
  }
  redraw();
  syncIO();
};

/* ---------------- rendering ---------------- */

function redraw(): void {
  grid.width = W() * CELL;
  grid.height = H() * CELL;
  gctx.imageSmoothingEnabled = false;
  for (let y = 0; y < H(); y++) {
    for (let x = 0; x < W(); x++) {
      gctx.fillStyle = (x + y) % 2 ? '#141830' : '#0f1226';
      gctx.fillRect(x * CELL, y * CELL, CELL, CELL);
      const color = pal()[cur()[y][x]];
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

/**
 * Every animation, playing at once. Raw art is drawn at 4x; the "hd"
 * toggle instead EPX-upscales twice (the game's 4x texel density) and
 * draws at 1x — the same on-screen size, so you see the smoothing the
 * game applies. The selected animation is highlighted.
 */
function renderPreview(): void {
  const hd = ($('hd') as HTMLInputElement).checked;
  const p = pal();
  const t = performance.now() / 1000;
  const names = Object.keys(file.anims);

  const rowHeights = names.map((n) => (file.anims[n].frames[0]?.length ?? 1) * 4 + 16);
  let maxW = 40;
  for (const n of names) maxW = Math.max(maxW, (file.anims[n].frames[0]?.[0]?.length ?? 1) * 4);
  preview.width = maxW + 16;
  preview.height = rowHeights.reduce((a, b) => a + b, 0) + 8;

  pctx.imageSmoothingEnabled = false;
  pctx.fillStyle = '#0a0c1c';
  pctx.fillRect(0, 0, preview.width, preview.height);

  let y = 6;
  names.forEach((name, i) => {
    const a = file.anims[name];
    const idx = a.frames.length ? Math.floor(t * (a.fps || 1)) % a.frames.length : 0;
    const rows = a.frames[idx] ?? [];
    pctx.fillStyle = name === animName ? '#ffcd75' : '#94b0c2';
    pctx.font = '11px monospace';
    pctx.fillText(`${name}  ${a.fps}fps`, 6, y + 9);
    const img = sprite(hd ? epx(epx(rows)) : rows, p);
    const scale = hd ? 1 : 4;
    pctx.save();
    pctx.translate(8, y + 14);
    pctx.scale(scale, scale);
    pctx.drawImage(img, 0, 0);
    pctx.restore();
    y += rowHeights[i];
  });
  requestAnimationFrame(renderPreview);
}

/* ---------------- io ---------------- */

function syncIO(): void {
  ($('io') as HTMLTextAreaElement).value = JSON.stringify(file, null, 2);
  ($('w') as HTMLInputElement).value = String(W());
  ($('h') as HTMLInputElement).value = String(H());
}

$('btnExport').onclick = () => {
  syncIO();
  navigator.clipboard?.writeText(($('io') as HTMLTextAreaElement).value);
  flash('copied to clipboard');
};

$('btnImport').onclick = () => {
  try {
    const raw = JSON.parse(($('io') as HTMLTextAreaElement).value);
    file = normalize(raw);
    animName = Object.keys(file.anims)[0];
    frameIdx = 0;
    currentChar = firstPaintChar();
    refreshUI();
    flash('imported');
  } catch (err) {
    flash(`import failed: ${(err as Error).message}`);
  }
};

/** Accept the SpriteFile format, or the older { palette, frames, fps }. */
function normalize(raw: unknown): SpriteFile {
  const r = raw as Record<string, unknown>;
  if (r && typeof r === 'object' && r.anims) {
    const f = r as unknown as SpriteFile;
    if (!f.anims || !Object.keys(f.anims).length) throw new Error('no animations');
    return { hd: f.hd ?? true, palette: f.palette ?? { ...PAL }, anims: f.anims };
  }
  if (r && Array.isArray(r.frames)) {
    return {
      hd: true,
      palette: (r.palette as Palette) ?? { ...PAL },
      anims: { idle: { fps: Number(r.fps) || 8, frames: r.frames as string[][] } },
    };
  }
  throw new Error('unrecognized sprite json');
}

/* ---------------- boot ---------------- */

function refreshUI(): void {
  buildPalette();
  buildAnims();
  buildFrames();
  redraw();
  syncIO();
}

refreshUI();
renderPreview();
