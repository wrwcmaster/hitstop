/// <reference types="vite/client" />

import { resolveAnim, sprite, epx, type Palette, type SpriteFile, type SpriteAnimData } from '@engine/index';
import { parseSpriteDocument, emptyFrame, geometryOf, type SpriteDocument } from './sprite-editor/document';
import { SpriteHistory } from './sprite-editor/history';
import { PAL } from '@game/content/palette';
import { weapons } from '@game/content/weapons';
import { CompositePreview, movesOf } from './sprite-editor/composite-preview';

/**
 * Sprite editor for the engine's per-sprite JSON format
 * (content/sprites/*.json): a palette plus named animations of 1x text
 * grids. Paint on a zoomed grid, manage animations and their frames, watch
 * every animation play at once (optionally EPX-upscaled to the game's 4x
 * "hd" density), then export/import the exact file the game loads.
 */

const CELL = 24;

/* ---------------- state ---------------- */

let file: SpriteDocument = {
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
let currentFileName = 'new sprite.json';
const history = new SpriteHistory();

function firstPaintChar(): string {
  const entry = Object.entries(file.palette).find(([, c]) => c);
  return entry ? entry[0] : '.';
}

const pal = (): Palette => file.palette;
/**
 * The animation being edited, RESOLVED: an alias entry ("plunge":
 * "attack") has no frames of its own, so selecting one jumps to its
 * target (see buildAnims) and this accessor follows the chain as a
 * belt-and-braces. Mutations through it therefore edit the target's
 * frames, which is the only thing an alias could mean in an editor.
 */
const anim = (): SpriteAnimData => resolveAnim(file, animName)!;
/** Concrete (non-alias) animations — the only ones with frames to edit,
 * resize, or export as art. */
const concreteAnims = (): [string, SpriteAnimData][] =>
  Object.entries(file.anims).filter((e): e is [string, SpriteAnimData] => typeof e[1] !== 'string');
const cur = () => anim().frames[frameIdx];
const W = () => cur()[0].length;
const H = () => cur().length;

const normalize = (raw: unknown): SpriteDocument => parseSpriteDocument(raw, PAL);

/* ---------------- dom ---------------- */

const $ = (id: string) => document.getElementById(id)!;
const grid = $('grid') as HTMLCanvasElement;
const gctx = grid.getContext('2d')!;
const preview = $('preview') as HTMLCanvasElement;
const pctx = preview.getContext('2d')!;

const SPRITE_ROOT = '/src/game/content/sprites/';
const spriteModules = import.meta.glob('/src/game/content/sprites/**/*.json', {
  eager: true,
  import: 'default',
}) as Record<string, SpriteFile>;
const existingSprites = new Map(
  Object.entries(spriteModules)
    .map(([modulePath, spriteFile]) => [modulePath.slice(SPRITE_ROOT.length), spriteFile] as const)
    .sort(([a], [b]) => a.localeCompare(b)),
);

function populateSpriteSelect(id: string): void {
  const select = $(id) as HTMLSelectElement;
  for (const path of existingSprites.keys()) {
    const option = document.createElement('option');
    option.value = path;
    option.textContent = path
      .replace(/\.json$/, '')
      .replaceAll('-', ' ')
      .replaceAll('/', ' / ');
    select.appendChild(option);
  }
}

function existingSprite(path: string): SpriteDocument {
  const spriteFile = existingSprites.get(path);
  if (!spriteFile) throw new Error(`unknown sprite "${path}"`);
  // Editor mutations must not alter the cached module or reference layer.
  return normalize(structuredClone(spriteFile));
}

populateSpriteSelect('selectSprite');
populateSpriteSelect('selectRefSprite');

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
  const ch = ($('newChar') as HTMLInputElement).value;
  if (ch.length !== 1) { flash('palette key must be one character'); return; }
  saveHistory();
  const color = ($('newColor') as HTMLInputElement).value;
  file.palette[ch] = color;
  currentChar = ch;
  buildPalette();
  redraw();
};

/* ---------------- animations ui ---------------- */

function buildAnims(): void {
  const host = $('anims');
  host.innerHTML = '';
  for (const name of Object.keys(file.anims)) {
    const entry = file.anims[name];
    const b = document.createElement('button');
    // An alias borrows another animation's frames; label the borrow so
    // "plunge→attack" reads as "no art of its own yet".
    b.textContent = typeof entry === 'string' ? `${name}→${entry}` : name;
    b.title = typeof entry === 'string'
      ? `alias: edits under this name change "${entry}"`
      : name;
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
  saveHistory();
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
  saveHistory();
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
  saveHistory();
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
  saveHistory();
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
  saveHistory();
  anim().frames.push(emptyFrame(W(), H()));
  frameIdx = anim().frames.length - 1;
  buildFrames();
  redraw();
  syncIO();
};
$('btnDupFrame').onclick = () => {
  saveHistory();
  anim().frames.splice(frameIdx + 1, 0, [...cur()]);
  frameIdx++;
  buildFrames();
  redraw();
  syncIO();
};
$('btnDelFrame').onclick = () => {
  if (anim().frames.length <= 1) return;
  saveHistory();
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
  saveHistory();
  // Resize every frame of every animation so the sprite stays uniform.
  for (const [, a] of concreteAnims()) {
    a.frames = a.frames.map((f: string[]) => {
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
  const showRef = ($('showRef') as HTMLInputElement).checked;
  if (refFile && showRef) {
    const refAnim = resolveAnim(refFile, animName in refFile.anims ? animName : Object.keys(refFile.anims)[0]);
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
  const onion = ($('onionSkin') as HTMLInputElement).checked;
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

/* ---------------- composite preview ---------------- */

/**
 * Bumped whenever `file` changes (paint, undo, load...). The composite
 * re-bakes an edited weapon sheet into its registered visual lazily —
 * only when this moves — so painting stays cheap.
 */
let editVersion = 0;
const compositePreview = new CompositePreview();

function rebuildMoveSelect(weaponId: string): void {
  const sel = $('compMove') as HTMLSelectElement;
  const prev = sel.value;
  sel.innerHTML = '';
  const auto = document.createElement('option');
  auto.value = '';
  auto.textContent = 'move: auto';
  sel.appendChild(auto);
  if (!weaponId || !weapons.has(weaponId)) return;
  for (const m of movesOf(weaponId)) {
    const o = document.createElement('option');
    o.value = m.key;
    o.textContent = `move: ${m.label}`;
    sel.appendChild(o);
  }
  if ([...sel.options].some((o) => o.value === prev)) sel.value = prev;
}

function renderComposite(t: number): boolean {
  return compositePreview.render(pctx, preview, t,
    { file, animName, fileName: currentFileName, version: editVersion },
    {
      weapon: ($('compWeapon') as HTMLSelectElement).value,
      move: ($('compMove') as HTMLSelectElement).value,
      body: ($('compBody') as HTMLSelectElement).value,
      gear: ($('compGear') as HTMLInputElement).checked,
      trail: ($('compTrail') as HTMLInputElement).checked,
      hitbox: ($('compHitbox') as HTMLInputElement).checked,
    });
}

function renderPreview(): void {
  const hd = ($('hd') as HTMLInputElement).checked;
  const p = pal();
  const t = performance.now() / 1000;

  const composite = renderComposite(t);
  // Give the game-scale composite the panel width it needs; hand the
  // space back the moment the weapon is deselected.
  $('side-right').classList.toggle('wide', composite);
  if (composite) {
    requestAnimationFrame(renderPreview);
    return;
  }

  const a = anim();
  if (!a || !a.frames.length) {
    requestAnimationFrame(renderPreview);
    return;
  }

  const idx = Math.floor(t * a.fps) % a.frames.length;
  const rows = a.frames[idx];

  const { w, h, hitbox } = geometryOf(file, rows);

  const displayW = w * 8; // scaled by ZOOM (4) * WORLD_ZOOM (2) = 8
  const displayH = h * 8;

  preview.width = displayW + 16;
  preview.height = displayH + 24;

  pctx.imageSmoothingEnabled = false;
  pctx.fillStyle = '#0a0c1c';
  pctx.fillRect(0, 0, preview.width, preview.height);

  // Draw active animation text label
  pctx.fillStyle = '#ffcd75';
  pctx.font = '11px monospace';
  pctx.fillText(`${animName}  ${a.fps}fps`, 8, 16);

  const isHighRes = file.hd === false;
  const drawRows = (isHighRes || !hd) ? rows : epx(epx(rows));
  const img = sprite(drawRows, p);

  const x = 8;
  const y = 20;

  // Draw reference sprite behind current frame if enabled
  const showRef = ($('showRef') as HTMLInputElement).checked;
  if (refFile && showRef) {
    const refAnim = resolveAnim(refFile, animName in refFile.anims ? animName : Object.keys(refFile.anims)[0]);
    if (refAnim) {
      const refIdx = Math.floor(t * refAnim.fps) % refAnim.frames.length;
      const refRows = refAnim.frames[refIdx];

      const refGeometry = geometryOf(refFile, refRows);
      const refIsHighRes = refFile.hd === false;
      const refDrawRows = (refIsHighRes || !hd) ? refRows : epx(epx(refRows));
      const refImg = sprite(refDrawRows, refFile.palette ?? PAL);

      pctx.save();
      pctx.globalAlpha = 0.3;
      pctx.drawImage(refImg, x, y, refGeometry.w * 8, refGeometry.h * 8);
      pctx.restore();
    }
  }

  // Draw active sprite frame
  pctx.drawImage(img, x, y, w * 8, h * 8);

  // Draw hitbox border (if enabled)
  if (($('showHitbox') as HTMLInputElement).checked) {
    pctx.save();
    pctx.strokeStyle = 'rgba(255, 68, 68, 0.85)';
    pctx.lineWidth = 1;
    const hx = x + hitbox.x * 8;
    const hy = y + hitbox.y * 8;
    const hw = hitbox.w * 8;
    const hh = hitbox.h * 8;
    pctx.strokeRect(hx + 0.5, hy + 0.5, hw - 1, hh - 1);
    pctx.restore();
  }
  requestAnimationFrame(renderPreview);
}

/* ---------------- io ---------------- */

function syncIO(): void {
  ($('io') as HTMLTextAreaElement).value = JSON.stringify(file, null, 2);
  ($('w') as HTMLInputElement).value = String(W());
  ($('h') as HTMLInputElement).value = String(H());

  const geometry = geometryOf(file, cur());
  ($('physW') as HTMLInputElement).value = String(geometry.w);
  ($('physH') as HTMLInputElement).value = String(geometry.h);
  ($('boxX') as HTMLInputElement).value = String(geometry.hitbox.x);
  ($('boxY') as HTMLInputElement).value = String(geometry.hitbox.y);
  ($('boxW') as HTMLInputElement).value = String(geometry.hitbox.w);
  ($('boxH') as HTMLInputElement).value = String(geometry.hitbox.h);
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
      currentFileName = f.name;
      editVersion++;
      history.clear();
      updateUndoRedoButtons();
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
  try {
    file = existingSprite(val);
    animName = Object.keys(file.anims)[0];
    frameIdx = 0;
    currentChar = firstPaintChar();
    editVersion++;

    const parts = val.split('/');
    currentFileName = parts[parts.length - 1];

    // Loading a weapon sheet sets the composite up for it: the knight
    // underneath, this weapon in hand — the view you actually want when
    // touching up a sword's attack frames.
    const stem = currentFileName.replace(/\.json$/, '');
    if (val.includes('equipment/') && weapons.has(stem)) {
      ($('compWeapon') as HTMLSelectElement).value = stem;
      ($('compBody') as HTMLSelectElement).value = 'player';
      // Setting .value programmatically fires no change event, so the
      // move list must be rebuilt by hand or it stays empty.
      rebuildMoveSelect(stem);
    }

    history.clear();
    updateUndoRedoButtons();
    refreshUI();
    flash(`loaded ${val}`);
  } catch (err) {
    flash(`load failed: ${(err as Error).message}`);
  }
};

// Save the current sprite as a downloadable .json.
$('btnSave').onclick = () => {
  syncIO();
  const blob = new Blob([($('io') as HTMLTextAreaElement).value], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = currentFileName;
  a.click();
  URL.revokeObjectURL(a.href);
  flash('saved');
};

$('btnImport').onclick = () => {
  try {
    const raw = JSON.parse(($('io') as HTMLTextAreaElement).value);
    const document = normalize(raw);
    saveHistory();
    file = document;
    animName = Object.keys(file.anims)[0];
    frameIdx = 0;
    currentChar = firstPaintChar();
    refreshUI();
    flash('imported');
  } catch (err) {
    flash(`import failed: ${(err as Error).message}`);
  }
};


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
  try {
    refFile = existingSprite(val);
    redraw();
    flash(`loaded reference: ${val}`);
  } catch (err) {
    flash(`reference load failed: ${(err as Error).message}`);
  }
};

($('showRef') as HTMLInputElement).onchange = () => redraw();
($('onionSkin') as HTMLInputElement).onchange = () => redraw();

$('btnNudgeLeft').onclick = () => nudge(-1, 0);
$('btnNudgeRight').onclick = () => nudge(1, 0);
$('btnNudgeUp').onclick = () => nudge(0, -1);
$('btnNudgeDown').onclick = () => nudge(0, 1);

function nudge(dx: number, dy: number): void {
  saveHistory();
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

/* ---------------- history (undo / redo) ---------------- */

function saveHistory(): void {
  editVersion++;
  history.checkpoint(file);
  updateUndoRedoButtons();
}

function restoreHistory(document: SpriteDocument | null, label: string): void {
  if (!document) return;
  file = document;
  editVersion++;
  if (!file.anims[animName]) animName = Object.keys(file.anims)[0];
  frameIdx = Math.min(frameIdx, anim().frames.length - 1);
  refreshUI();
  updateUndoRedoButtons();
  flash(label);
}

function undo(): void { restoreHistory(history.undo(file), 'undo'); }
function redo(): void { restoreHistory(history.redo(file), 'redo'); }

function updateUndoRedoButtons(): void {
  ($('btnUndo') as HTMLButtonElement).disabled = !history.canUndo;
  ($('btnRedo') as HTMLButtonElement).disabled = !history.canRedo;
}

$('btnUndo').onclick = () => undo();
$('btnRedo').onclick = () => redo();

window.addEventListener('keydown', (e) => {
  const key = e.key.toLowerCase();
  if ((e.ctrlKey || e.metaKey) && key === 'z') {
    e.preventDefault();
    if (e.shiftKey) {
      redo();
    } else {
      undo();
    }
  }
  if ((e.ctrlKey || e.metaKey) && key === 'y') {
    e.preventDefault();
    redo();
  }
});

($('hd') as HTMLInputElement).onchange = (e) => {
  file.hd = (e.target as HTMLInputElement).checked;
  syncIO();
};

// Physical size inputs → write to file.w / file.h
function onPhysChange(): void {
  const pw = ($('physW') as HTMLInputElement).valueAsNumber;
  const ph = ($('physH') as HTMLInputElement).valueAsNumber;
  if (!(pw > 0) || !(ph > 0)) {
    flash('physical size must be positive');
    syncIO();
    return;
  }
  saveHistory();
  file.w = pw;
  file.h = ph;
  syncIO();
}
($('physW') as HTMLInputElement).onchange = onPhysChange;
($('physH') as HTMLInputElement).onchange = onPhysChange;

// Hitbox inputs → write to file.hitbox
function onHitboxChange(): void {
  const bx = ($('boxX') as HTMLInputElement).valueAsNumber;
  const by = ($('boxY') as HTMLInputElement).valueAsNumber;
  const bw = ($('boxW') as HTMLInputElement).valueAsNumber;
  const bh = ($('boxH') as HTMLInputElement).valueAsNumber;
  if (!Number.isFinite(bx) || !Number.isFinite(by) || !(bw > 0) || !(bh > 0)) {
    flash('hitbox needs finite x/y and positive w/h');
    syncIO();
    return;
  }
  const { w, h } = geometryOf(file, cur());
  saveHistory();
  // Only store hitbox if it differs from the full physical size at origin
  if (bx === 0 && by === 0 && bw === w && bh === h) {
    delete file.hitbox;
  } else {
    file.hitbox = { x: bx, y: by, w: bw, h: bh };
  }
  syncIO();
}
($('boxX') as HTMLInputElement).onchange = onHitboxChange;
($('boxY') as HTMLInputElement).onchange = onHitboxChange;
($('boxW') as HTMLInputElement).onchange = onHitboxChange;
($('boxH') as HTMLInputElement).onchange = onHitboxChange;

/* ---------------- boot ---------------- */

function refreshUI(): void {
  buildPalette();
  buildAnims();
  buildFrames();
  redraw();
  syncIO();

  const hdCheckbox = $('hd') as HTMLInputElement;
  hdCheckbox.checked = file.hd;
}

refreshUI();
// Editor state, surfaced for scripted verification (the same doorway
// __harness/__replay give the game proper).
Object.defineProperty(window, '__editor', {
  value: {
    get file() { return file; },
    get currentFileName() { return currentFileName; },
    get editVersion() { return editVersion; },
    get rebuiltVersion() { return compositePreview.bakedVersion; },
  },
});

// Composite weapon picker: every registered weapon except bare hands.
{
  const sel = $('compWeapon') as HTMLSelectElement;
  sel.onchange = () => rebuildMoveSelect(sel.value);
  for (const id of weapons.ids()) {
    if (id === 'unarmed') continue;
    const o = document.createElement('option');
    o.value = id;
    o.textContent = id;
    sel.appendChild(o);
  }
}

rebuildMoveSelect(($('compWeapon') as HTMLSelectElement).value);
renderPreview();
