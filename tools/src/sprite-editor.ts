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
let currentTool: 'draw' | 'fill' = 'draw';
let refFile: SpriteFile | null = null;

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
  // Always ensure transparent/erase is at the top of the palette list
  const entries: [string, string | null][] = [['.', null], ...Object.entries(pal()).filter(([ch]) => ch !== '.')];
  for (const [ch, color] of entries) {
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

function floodFill(startX: number, startY: number, fillChar: string): void {
  const f = cur();
  const targetChar = f[startY]?.[startX];
  if (targetChar === undefined || targetChar === fillChar) return;
  
  const w = W();
  const h = H();
  const queue: [number, number][] = [[startX, startY]];
  const visited = new Set<string>();
  
  while (queue.length > 0) {
    const [x, y] = queue.shift()!;
    const key = `${x},${y}`;
    if (visited.has(key)) continue;
    visited.add(key);
    
    if (f[y]?.[x] === targetChar) {
      setPixel(x, y, fillChar);
      
      if (x > 0) queue.push([x - 1, y]);
      if (x < w - 1) queue.push([x + 1, y]);
      if (y > 0) queue.push([x, y - 1]);
      if (y < h - 1) queue.push([x, y + 1]);
    }
  }
}

grid.addEventListener('contextmenu', (e) => e.preventDefault());
grid.addEventListener('mousedown', (e) => {
  erasing = e.button === 2;
  painting = true;
  paint(e);
});
grid.addEventListener('mousemove', (e) => {
  if (painting && currentTool !== 'fill') paint(e); // Don't drag-fill for bucket
});
window.addEventListener('mouseup', () => {
  if (painting) {
    painting = false;
    syncIO();
  }
});

function paint(e: MouseEvent): void {
  const r = grid.getBoundingClientRect();
  const x = Math.floor((e.clientX - r.left) / CELL);
  const y = Math.floor((e.clientY - r.top) / CELL);
  if (currentTool === 'fill') {
    floodFill(x, y, erasing ? '.' : currentChar);
  } else {
    setPixel(x, y, erasing ? '.' : currentChar);
  }
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

function redraw(): void {
  grid.width = W() * CELL;
  grid.height = H() * CELL;
  gctx.imageSmoothingEnabled = false;

  // 1. Draw base background (gaps/borders)
  gctx.fillStyle = '#080a18';
  gctx.fillRect(0, 0, grid.width, grid.height);

  // 2. Draw inset checkerboard for all cells
  const inset = 3;
  for (let y = 0; y < H(); y++) {
    for (let x = 0; x < W(); x++) {
      gctx.fillStyle = (x + y) % 2 ? '#141830' : '#0f1226';
      gctx.fillRect(x * CELL + inset, y * CELL + inset, CELL - inset * 2, CELL - inset * 2);
      
      gctx.strokeStyle = 'rgba(255, 255, 255, 0.04)';
      gctx.strokeRect(x * CELL + inset + 0.5, y * CELL + inset + 0.5, CELL - inset * 2 - 1, CELL - inset * 2 - 1);
    }
  }

  // 3. Draw reference sprite if enabled
  const showRef = ($('showRef') as HTMLInputElement)?.checked ?? true;
  if (refFile && showRef) {
    const refAnim = refFile.anims[animName] ?? Object.values(refFile.anims)[0];
    if (refAnim) {
      const refFrame = refAnim.frames[frameIdx % refAnim.frames.length];
      if (refFrame) {
        gctx.save();
        gctx.globalAlpha = 0.3;
        for (let y = 0; y < H(); y++) {
          for (let x = 0; x < W(); x++) {
            const char = refFrame[y]?.[x];
            if (char) {
              const color = (refFile.palette ?? {})[char] ?? PAL[char];
              if (color) {
                gctx.fillStyle = color;
                gctx.fillRect(x * CELL, y * CELL, CELL, CELL);
              }
            }
          }
        }
        gctx.restore();
      }
    }
  }

  // 4. Draw onion skin if enabled
  const onion = ($('onionSkin') as HTMLInputElement)?.checked ?? false;
  if (onion && frameIdx > 0) {
    const prevFrame = anim().frames[frameIdx - 1];
    if (prevFrame) {
      gctx.save();
      gctx.globalAlpha = 0.2;
      for (let y = 0; y < H(); y++) {
        for (let x = 0; x < W(); x++) {
          const color = pal()[prevFrame[y]?.[x]];
          if (color) {
            gctx.fillStyle = color;
            gctx.fillRect(x * CELL, y * CELL, CELL, CELL);
          }
        }
      }
      gctx.restore();
    }
  }

  // 5. Draw current frame solid pixels
  for (let y = 0; y < H(); y++) {
    for (let x = 0; x < W(); x++) {
      const color = pal()[cur()[y][x]];
      if (color) {
        gctx.fillStyle = color;
        gctx.fillRect(x * CELL, y * CELL, CELL, CELL);
      }
    }
  }

  // 6. Grid lines
  gctx.strokeStyle = 'rgba(148,176,194,0.1)';
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

    const scale = hd ? 1 : 4;

    // Draw reference sprite in preview background if enabled
    const showRef = ($('showRef') as HTMLInputElement)?.checked ?? true;
    if (refFile && showRef) {
      const refAnim = refFile.anims[name] ?? Object.values(refFile.anims)[0];
      if (refAnim) {
        const refIdx = refAnim.frames.length ? Math.floor(t * (refAnim.fps || 1)) % refAnim.frames.length : 0;
        const refRows = refAnim.frames[refIdx] ?? [];
        const refImg = sprite(hd ? epx(epx(refRows)) : refRows, refFile.palette ?? PAL);
        pctx.save();
        pctx.translate(8, y + 14);
        pctx.scale(scale, scale);
        pctx.globalAlpha = 0.45;
        pctx.drawImage(refImg, 0, 0);
        pctx.restore();
      }
    }

    const img = sprite(hd ? epx(epx(rows)) : rows, p);
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

// Load a .json sprite file straight from disk.
$('btnLoad').onclick = () => ($('fileInput') as HTMLInputElement).click();
($('fileInput') as HTMLInputElement).onchange = (e) => {
  const input = e.target as HTMLInputElement;
  const f = input.files?.[0];
  if (!f) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      file = normalize(JSON.parse(String(reader.result)));
      animName = Object.keys(file.anims)[0];
      frameIdx = 0;
      currentChar = firstPaintChar();
      refreshUI();
      flash(`loaded ${f.name}`);
      ($('selectSprite') as HTMLSelectElement).value = ''; // clear dropdown
    } catch (err) {
      flash(`load failed: ${(err as Error).message}`);
    }
  };
  reader.readAsText(f);
  input.value = ''; // allow re-loading the same file
};

$('selectSprite').onchange = (e) => {
  const val = (e.target as HTMLSelectElement).value;
  if (!val) return;
  fetch('/src/game/content/sprites/' + val)
    .then(r => {
      if (!r.ok) throw new Error(`HTTP error! status: ${r.status}`);
      return r.json();
    })
    .then(json => {
      file = normalize(json);
      animName = Object.keys(file.anims)[0];
      frameIdx = 0;
      currentChar = firstPaintChar();
      refreshUI();
      flash(`loaded ${val}`);
    })
    .catch(err => {
      flash(`load failed: ${err.message}`);
    });
};

// Save the current sprite as a downloadable .json.
$('btnSave').onclick = () => {
  syncIO();
  const blob = new Blob([($('io') as HTMLTextAreaElement).value], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${animName || 'sprite'}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
  flash('saved');
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

/* ---------------- tools & reference & nudge ---------------- */

$('btnToolDraw').onclick = () => {
  currentTool = 'draw';
  $('btnToolDraw').classList.add('active');
  $('btnToolFill').classList.remove('active');
};
$('btnToolFill').onclick = () => {
  currentTool = 'fill';
  $('btnToolFill').classList.add('active');
  $('btnToolDraw').classList.remove('active');
};

$('btnLoadRef').onclick = () => ($('refFileInput') as HTMLInputElement).click();
($('refFileInput') as HTMLInputElement).onchange = (e) => {
  const input = e.target as HTMLInputElement;
  const f = input.files?.[0];
  if (!f) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      refFile = normalize(JSON.parse(String(reader.result)));
      redraw();
      flash(`loaded reference: ${f.name}`);
      ($('selectRefSprite') as HTMLSelectElement).value = ''; // clear dropdown
    } catch (err) {
      flash(`reference load failed: ${(err as Error).message}`);
    }
  };
  reader.readAsText(f);
  input.value = '';
};

$('selectRefSprite').onchange = (e) => {
  const val = (e.target as HTMLSelectElement).value;
  if (!val) {
    refFile = null;
    redraw();
    return;
  }
  fetch('/src/game/content/sprites/' + val)
    .then(r => {
      if (!r.ok) throw new Error(`HTTP error! status: ${r.status}`);
      return r.json();
    })
    .then(json => {
      refFile = normalize(json);
      redraw();
      flash(`loaded reference: ${val}`);
    })
    .catch(err => {
      flash(`reference load failed: ${err.message}`);
    });
};

($('showRef') as HTMLInputElement).onchange = () => redraw();
($('onionSkin') as HTMLInputElement).onchange = () => redraw();

$('btnNudgeLeft').onclick = () => nudge(-1, 0);
$('btnNudgeRight').onclick = () => nudge(1, 0);
$('btnNudgeUp').onclick = () => nudge(0, -1);
$('btnNudgeDown').onclick = () => nudge(0, 1);

function nudge(dx: number, dy: number): void {
  const w = W();
  const h = H();
  const f = cur();
  const next: string[] = [];
  
  for (let y = 0; y < h; y++) {
    const srcY = (y - dy + h) % h;
    let row = '';
    for (let x = 0; x < w; x++) {
      const srcX = (x - dx + w) % w;
      row += f[srcY][srcX];
    }
    next.push(row);
  }
  
  anim().frames[frameIdx] = next;
  redraw();
  syncIO();
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
