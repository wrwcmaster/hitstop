import { type SheetDescriptor, type SheetRect } from '@engine/index';

/**
 * Sprite-sheet slicer: load a PNG, describe how to cut it into frames —
 * either a uniform GRID, or free RECTS you drag per frame (for irregular
 * sheets) — list which frames make up each animation, preview them, and
 * export a SheetDescriptor JSON the game loads with `loadSheet`.
 */

const $ = (id: string) => document.getElementById(id)!;
const sheet = $('sheet') as HTMLCanvasElement;
const sctx = sheet.getContext('2d')!;
const preview = $('preview') as HTMLCanvasElement;
const pctx = preview.getContext('2d')!;

let img: HTMLImageElement | null = null;
let imageName = 'sheet.png';
let mode: 'grid' | 'rects' = 'grid';
let viewMode: 'source' | 'normalized' = 'source';
let protectingKeyColor = false;
let zoom = 3;
let previewZoom = 0.75;
let urlSyncReady = false;
/** Explicit per-frame rects (rects mode). */
let rects: SheetRect[] = [];
/** Source-space regions whose subject colors must survive chroma removal. */
let protectedRects: SheetRect[] = [];
/** Per-frame placement inside the normalized shared cell. */
let offsets: { x: number; y: number }[] = [];
let prepared: HTMLCanvasElement | null = null;
let normalizedCache: { canvas: HTMLCanvasElement; frameW: number; frameH: number } | null = null;
/** In-progress drag rectangle (image pixel coords). */
let drag: { x: number; y: number; x2: number; y2: number } | null = null;
/** In-progress move of an existing rect: its index + grab offset. */
let moving: { i: number; dx: number; dy: number; moved: boolean } | null = null;
let movingProtection: { i: number; dx: number; dy: number; moved: boolean } | null = null;
let protectionDrag: { x: number; y: number; x2: number; y2: number } | null = null;
/** anim name -> { frames:number[], fps } */
const anims: Record<string, { frames: number[]; fps: number }> = {
  idle: { frames: [0], fps: 4 },
};

const approvalIds = ['approveSource', 'approveIdentity', 'approveMotion', 'approveAlignment'] as const;

function approvalsReady(): boolean {
  return approvalIds.every((id) => ($(id) as HTMLInputElement).checked);
}

function updateApprovalGate(): void {
  const ready = approvalsReady();
  ($('btnExportSprite') as HTMLButtonElement).disabled = !ready;
  $('approvalGate').classList.toggle('ready', ready);
  $('approvalStatus').textContent = ready
    ? 'Approved generated source and normalized pixels: JSON conversion is unlocked.'
    : 'JSON conversion is locked.';
}

function invalidateApprovals(): void {
  normalizedCache = null;
  for (const id of approvalIds) ($(id) as HTMLInputElement).checked = false;
  updateApprovalGate();
}

for (const id of approvalIds) {
  ($(id) as HTMLInputElement).onchange = updateApprovalGate;
}

function flash(msg: string): void {
  const s = $('status');
  s.textContent = msg;
  setTimeout(() => {
    if (s.textContent === msg) s.textContent = '';
  }, 2500);
}

const num = (id: string) => Number(($(id) as HTMLInputElement).value) || 0;
function grid() {
  return { frameW: num('fw'), frameH: num('fh'), margin: num('margin'), spacing: num('spacing'), texel: num('texel') || 4 };
}
function cols(): number {
  if (!img) return 1;
  const g = grid();
  return g.frameW > 0 ? Math.max(1, Math.floor((img.width - g.margin + g.spacing) / (g.frameW + g.spacing))) : 1;
}
function gridCount(): number {
  if (!img) return 0;
  const g = grid();
  const rows = g.frameH > 0 ? Math.max(1, Math.floor((img.height - g.margin + g.spacing) / (g.frameH + g.spacing))) : 1;
  return cols() * rows;
}
function frameCount(): number {
  return mode === 'rects' ? rects.length : gridCount();
}
function rectOf(i: number): SheetRect {
  if (mode === 'rects') return rects[i];
  const g = grid();
  const c = i % cols();
  const r = Math.floor(i / cols());
  return { x: g.margin + c * (g.frameW + g.spacing), y: g.margin + r * (g.frameH + g.spacing), w: g.frameW, h: g.frameH };
}

/* ---------------- modes ---------------- */

function buildModeBtns(): void {
  const host = $('modeBtns');
  host.innerHTML = '';
  (['grid', 'rects'] as const).forEach((m) => {
    const b = document.createElement('button');
    b.textContent = m;
    b.style.marginRight = '4px';
    b.className = mode === m ? 'active' : '';
    if (mode === m) {
      b.style.background = '#38b764';
      b.style.color = '#07070d';
    }
    b.onclick = () => {
      mode = m;
      offsets = [];
      invalidateApprovals();
      ($('gridControls') as HTMLElement).style.display = m === 'grid' ? '' : 'none';
      ($('rectControls') as HTMLElement).style.display = m === 'rects' ? '' : 'none';
      buildModeBtns();
      buildAlignmentList();
      drawSheet();
      syncIO();
    };
    host.appendChild(b);
  });
}

/* ---------------- load ---------------- */

function acceptImage(i: HTMLImageElement, name: string, afterLoad?: () => void): void {
  img = i;
  imageName = name;
  prepared = null;
  protectedRects = [];
  offsets = [];
  invalidateApprovals();
  flash(`loaded ${name} (${i.width}x${i.height})`);
  buildProtectionList();
  buildAlignmentList();
  drawSheet();
  syncIO();
  afterLoad?.();
}

function buildViewBtns(): void {
  for (const [id, value] of [['btnViewSource', 'source'], ['btnViewNormalized', 'normalized']] as const) {
    const button = $(id) as HTMLButtonElement;
    const active = viewMode === value;
    button.classList.toggle('active', active);
    button.style.background = active ? '#38b764' : '';
    button.style.color = active ? '#07070d' : '';
    button.onclick = () => {
      if (value === 'normalized' && !normalizedSheet()) {
        flash('slice at least one frame before viewing normalized pixels');
        return;
      }
      viewMode = value;
      buildViewBtns();
      drawSheet();
      fitDisplayedSheet();
      syncUrlState();
    };
  }
  $('previewStage').textContent = viewMode === 'normalized' ? 'normalized pixels' : 'generated source';
}

function loadImageUrl(src: string, name = src.split('/').pop() || 'sheet.png', afterLoad?: () => void): void {
  const i = new Image();
  i.onload = () => acceptImage(i, name, afterLoad);
  i.onerror = () => flash(`could not load ${src}`);
  i.src = src;
}

$('btnLoad').onclick = () => ($('fileInput') as HTMLInputElement).click();
($('fileInput') as HTMLInputElement).onchange = (e) => {
  const input = e.target as HTMLInputElement;
  const f = input.files?.[0];
  if (!f) return;
  imageName = f.name;
  const reader = new FileReader();
  reader.onload = () => {
    const i = new Image();
    i.onload = () => {
      acceptImage(i, f.name);
      flash(`loaded ${f.name} (${i.width}×${i.height})`);
      drawSheet();
      syncIO();
    };
    i.src = String(reader.result);
  };
  reader.readAsDataURL(f);
  input.value = '';
};

$('btnLoadUrl').onclick = () => {
  const src = ($('imageUrl') as HTMLInputElement).value.trim();
  if (src) loadImageUrl(src);
};

for (const id of ['fw', 'fh', 'margin', 'spacing', 'texel']) {
  ($(id) as HTMLInputElement).onchange = () => {
    offsets = [];
    invalidateApprovals();
    buildAlignmentList();
    drawSheet();
    syncIO();
  };
}

function sourceImage(): CanvasImageSource | null {
  if (!img) return null;
  if (!($('keyEnabled') as HTMLInputElement).checked) return img;
  if (prepared) return prepared;

  prepared = document.createElement('canvas');
  prepared.width = img.width;
  prepared.height = img.height;
  const ctx = prepared.getContext('2d')!;
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, prepared.width, prepared.height);
  const color = ($('keyColor') as HTMLInputElement).value;
  const key = [1, 3, 5].map((i) => Number.parseInt(color.slice(i, i + 2), 16));
  const peak = Math.max(...key);
  // Spill suppression must follow the key's chroma signature, not merely its
  // first strongest channel. Magenta has two peaks (red + blue); treating it
  // as red alone erases perfectly valid skin, hair, and leather colors.
  const dominantChannels = [0, 1, 2].filter((i) => peak - key[i] <= 8);
  const otherChannels = [0, 1, 2].filter((i) => !dominantChannels.includes(i));
  const tolerance = Math.max(0, num('keyTolerance'));
  const isProtected = (x: number, y: number) => protectedRects.some((r) =>
    x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h);
  for (let p = 0; p < data.data.length; p += 4) {
    const pixel = p / 4;
    if (isProtected(pixel % prepared.width, Math.floor(pixel / prepared.width))) continue;
    const distance = Math.max(
      Math.abs(data.data[p] - key[0]),
      Math.abs(data.data[p + 1] - key[1]),
      Math.abs(data.data[p + 2] - key[2]),
    );
    if (distance <= tolerance) {
      data.data[p + 3] = 0;
    } else if (distance < tolerance + 48) {
      // Soft matte the antialiased fringe instead of leaving a neon halo.
      const opacity = (distance - tolerance) / 48;
      data.data[p + 3] = Math.round(data.data[p + 3] * opacity);
      if (otherChannels.length) {
        const neutralKey = Math.max(...otherChannels.map((i) => data.data[p + i]));
        for (const dominant of dominantChannels) {
          const channel = p + dominant;
          data.data[channel] = Math.round(neutralKey + (data.data[channel] - neutralKey) * opacity);
        }
      }
    }
    if (!otherChannels.length) continue;
    const neutral = Math.max(...otherChannels.map((i) => data.data[p + i]));
    const keyedLevel = Math.min(...dominantChannels.map((i) => data.data[p + i]));
    const dominance = keyedLevel - neutral;
    if (dominance > 4) {
      // Remove key-colored spill that is too dark to match the distance
      // threshold. A true subject color close to the key is already forbidden
      // by the generation brief; near-neutral teal cloth is unaffected.
      const spill = Math.min(1, (dominance - 4) / 72);
      data.data[p + 3] = Math.round(data.data[p + 3] * (1 - spill));
      for (const dominant of dominantChannels) {
        const channel = p + dominant;
        data.data[channel] = Math.round(neutral + (data.data[channel] - neutral) * (1 - spill));
      }
    }
  }
  ctx.putImageData(data, 0, 0);
  return prepared;
}

function sourcePreparationChanged(): void {
  prepared = null;
  invalidateApprovals();
  drawSheet();
  syncIO();
}

function protectionChanged(): void {
  prepared = null;
  invalidateApprovals();
  buildProtectionList();
  drawSheet();
  syncIO();
}

function buildProtectionControls(): void {
  const button = $('btnProtectKey') as HTMLButtonElement;
  button.classList.toggle('active', protectingKeyColor);
  button.style.background = protectingKeyColor ? '#38b764' : '';
  button.style.color = protectingKeyColor ? '#07070d' : '';
  button.textContent = protectingKeyColor ? 'finish protecting' : 'protect subject color';
  button.onclick = () => {
    protectingKeyColor = !protectingKeyColor;
    if (protectingKeyColor && viewMode !== 'source') {
      viewMode = 'source';
      buildViewBtns();
      fitDisplayedSheet();
    }
    buildProtectionControls();
    drawSheet();
    syncUrlState();
  };
}

function buildProtectionList(): void {
  const host = $('protectionList');
  host.innerHTML = '';
  protectedRects.forEach((r, i) => {
    const row = document.createElement('div');
    row.className = 'row';
    row.style.cssText = 'display:flex;gap:3px;align-items:center;margin:2px 0';
    row.innerHTML = `<span style="width:16px;color:#73eff7">${i}</span>`;
    (['x', 'y', 'w', 'h'] as const).forEach((k) => {
      const input = document.createElement('input');
      input.type = 'number';
      input.value = String(r[k]);
      input.style.width = '46px';
      input.title = k;
      input.onchange = () => {
        r[k] = Number(input.value) || 0;
        protectionChanged();
      };
      row.appendChild(input);
    });
    const del = document.createElement('button');
    del.textContent = 'x';
    del.title = 'remove protected region';
    del.onclick = () => {
      protectedRects.splice(i, 1);
      protectionChanged();
    };
    row.appendChild(del);
    host.appendChild(row);
  });
}

$('btnClearProtection').onclick = () => {
  if (!protectedRects.length) return;
  protectedRects = [];
  protectionChanged();
};

$('btnAddProtection').onclick = () => {
  if (!img) { flash('load a sheet first'); return; }
  const size = Math.max(1, Math.round(num('protectSize')) || 24);
  protectedRects.push({ x: 0, y: 0, w: Math.min(size, img.width), h: Math.min(size, img.height) });
  protectionChanged();
};

for (const id of [
  'keyEnabled', 'keyColor', 'keyTolerance', 'targetW', 'targetH',
  'resampleMode', 'maxColors', 'lockProtectedPixels', 'trimTransparent',
  'sharedTrimTop', 'sharedTrimRight', 'sharedTrimBottom', 'sharedTrimLeft',
]) {
  ($(id) as HTMLInputElement).onchange = sourcePreparationChanged;
}
for (const id of ['detectPadding', 'protectSize', 'rw', 'rh']) {
  ($(id) as HTMLInputElement).onchange = syncIO;
}

function detectFrames(): void {
  if (!img) { flash('load an image first'); return; }
  const src = sourceImage();
  if (!src) return;
  const cv = document.createElement('canvas');
  cv.width = img.width;
  cv.height = img.height;
  const ctx = cv.getContext('2d')!;
  ctx.drawImage(src, 0, 0);
  const data = ctx.getImageData(0, 0, cv.width, cv.height).data;
  const active = new Array(cv.width).fill(false);
  for (let y = 0; y < cv.height; y += 1) {
    for (let x = 0; x < cv.width; x += 1) {
      if (data[(y * cv.width + x) * 4 + 3] >= 128) active[x] = true;
    }
  }
  const runs: { x1: number; x2: number }[] = [];
  for (let x = 0; x < active.length;) {
    if (!active[x]) { x += 1; continue; }
    const x1 = x;
    while (x + 1 < active.length && active[x + 1]) x += 1;
    runs.push({ x1, x2: x });
    x += 1;
  }
  if (!runs.length) { flash('no opaque frames detected'); return; }

  const pad = Math.max(0, Math.round(num('detectPadding')));
  const figures = runs.map(({ x1, x2 }) => {
    let y1 = cv.height, y2 = -1, pixels = 0;
    for (let y = 0; y < cv.height; y += 1) {
      for (let x = x1; x <= x2; x += 1) {
        if (data[(y * cv.width + x) * 4 + 3] >= 128) {
          y1 = Math.min(y1, y);
          y2 = Math.max(y2, y);
          pixels += 1;
        }
      }
    }
    return { x1, x2, y1, y2, pixels };
  });
  // Chroma-key fringes sometimes leave a tiny isolated fleck at a sheet
  // edge. Keep figure-scale components, not every surviving pixel island.
  const tallest = Math.max(...figures.map((f) => f.y2 - f.y1 + 1));
  const densest = Math.max(...figures.map((f) => f.pixels));
  const detected = figures
    .filter((f) => f.y2 - f.y1 + 1 >= tallest * 0.35 && f.pixels >= densest * 0.05)
    .map(({ x1, x2, y1, y2 }) => {
      const left = Math.max(0, x1 - pad);
      const top = Math.max(0, y1 - pad);
      const right = Math.min(cv.width - 1, x2 + pad);
      const bottom = Math.min(cv.height - 1, y2 + pad);
      return { x: left, y: top, w: right - left + 1, h: bottom - top + 1 };
    });
  // Animation frames share one camera cell. Tight crops with independent sizes
  // make normalization rescale each pose, turning a small breath into a zoom.
  // Expand every detection to the largest frame, centered on the figure and
  // anchored to its baseline, so motion stays motion and scale stays constant.
  const sharedW = Math.max(...detected.map((r) => r.w));
  const sharedH = Math.max(...detected.map((r) => r.h));
  rects = detected.map((r) => {
    const center = r.x + r.w / 2;
    const baseline = r.y + r.h;
    const x = Math.max(0, Math.min(cv.width - sharedW, Math.round(center - sharedW / 2)));
    const y = Math.max(0, Math.min(cv.height - sharedH, baseline - sharedH));
    return { x, y, w: sharedW, h: sharedH };
  });
  mode = 'rects';
  viewMode = 'normalized';
  offsets = rects.map(() => ({ x: 0, y: 0 }));
  anims.idle.frames = rects.map((_, i) => i);
  invalidateApprovals();
  ($('gridControls') as HTMLElement).style.display = 'none';
  ($('rectControls') as HTMLElement).style.display = '';
  buildModeBtns();
  buildViewBtns();
  buildRectList();
  buildAlignmentList();
  buildAnims();
  drawSheet();
  syncIO();
  fitDisplayedSheet();
  flash(`detected ${rects.length} frame${rects.length === 1 ? '' : 's'}`);
}

$('btnDetect').onclick = detectFrames;

/* ---------------- zoom ---------------- */

function setZoom(z: number): void {
  zoom = Math.max(0.1, Math.min(16, z));
  $('zoomLbl').textContent = `${zoom < 1 ? zoom.toFixed(2) : zoom.toFixed(1)}×`;
  drawSheet();
  syncUrlState();
}
$('btnZoomIn').onclick = () => setZoom(zoom * 1.5);
$('btnZoomOut').onclick = () => setZoom(zoom / 1.5);
function fitDisplayedSheet(): void {
  if (!img) return;
  const view = $('view');
  const normalized = viewMode === 'normalized' ? normalizedSheet() : null;
  const width = normalized?.canvas.width ?? img.width;
  const height = normalized?.canvas.height ?? img.height;
  setZoom(Math.min((view.clientWidth - 32) / width, (view.clientHeight - 32) / height));
}
$('btnFit').onclick = fitDisplayedSheet;
$('view').addEventListener('wheel', (e) => {
  if (!e.ctrlKey && !e.metaKey) return; // ctrl/cmd + wheel zooms; plain wheel scrolls
  e.preventDefault();
  setZoom(zoom * (e.deltaY < 0 ? 1.2 : 1 / 1.2));
}, { passive: false });

/* ---------------- rect drawing ---------------- */

function sheetPos(e: MouseEvent): { x: number; y: number } {
  const r = sheet.getBoundingClientRect();
  return {
    x: Math.max(0, Math.min(img ? img.width : 0, Math.round((e.clientX - r.left) / zoom))),
    y: Math.max(0, Math.min(img ? img.height : 0, Math.round((e.clientY - r.top) / zoom))),
  };
}
function normRect(d: { x: number; y: number; x2: number; y2: number }): SheetRect {
  return { x: Math.min(d.x, d.x2), y: Math.min(d.y, d.y2), w: Math.abs(d.x2 - d.x), h: Math.abs(d.y2 - d.y) };
}
/** Default frame size for tap-to-place / + frame (rects mode). */
function defSize(): { w: number; h: number } {
  return { w: Math.max(1, num('rw') || 32), h: Math.max(1, num('rh') || 48) };
}
/** Index of the topmost rect covering an image-pixel point, or -1. */
function rectAtIndex(x: number, y: number): number {
  for (let i = rects.length - 1; i >= 0; i--) {
    const r = rects[i];
    if (x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) return i;
  }
  return -1;
}
function protectionAtIndex(x: number, y: number): number {
  for (let i = protectedRects.length - 1; i >= 0; i--) {
    const r = protectedRects[i];
    if (x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) return i;
  }
  return -1;
}
/** A default-sized frame anchored top-left at (x,y), clamped inside the image. */
function placedRect(x: number, y: number): SheetRect {
  const { w, h } = defSize();
  const iw = img ? img.width : w, ih = img ? img.height : h;
  return { x: Math.max(0, Math.min(iw - w, x)), y: Math.max(0, Math.min(ih - h, y)), w, h };
}
sheet.addEventListener('contextmenu', (e) => e.preventDefault());
sheet.addEventListener('mousedown', (e) => {
  if (viewMode !== 'source' || !img) return;
  const p = sheetPos(e);
  if (protectingKeyColor) {
    if (e.button === 2) {
      const hit = protectionAtIndex(p.x, p.y);
      if (hit >= 0) {
        protectedRects.splice(hit, 1);
        protectionChanged();
      }
      return;
    }
    const hit = protectionAtIndex(p.x, p.y);
    if (hit >= 0) {
      movingProtection = {
        i: hit,
        dx: p.x - protectedRects[hit].x,
        dy: p.y - protectedRects[hit].y,
        moved: false,
      };
    } else {
      protectionDrag = { x: p.x, y: p.y, x2: p.x, y2: p.y };
    }
    return;
  }
  if (mode !== 'rects') return;
  if (e.button === 2) {
    // Remove the topmost rect under the cursor.
    const hit = rectAtIndex(p.x, p.y);
    if (hit >= 0) {
      rects.splice(hit, 1);
      offsets.splice(hit, 1);
      invalidateApprovals();
      buildRectList();
      buildAlignmentList();
      drawSheet();
      syncIO();
    }
    return;
  }
  // Grab an existing frame to move it; otherwise start drawing a new one.
  const hit = rectAtIndex(p.x, p.y);
  if (hit >= 0) {
    moving = { i: hit, dx: p.x - rects[hit].x, dy: p.y - rects[hit].y, moved: false };
  } else {
    drag = { x: p.x, y: p.y, x2: p.x, y2: p.y };
  }
});
sheet.addEventListener('mousemove', (e) => {
  if (movingProtection && img) {
    const p = sheetPos(e);
    const r = protectedRects[movingProtection.i];
    r.x = Math.max(0, Math.min(img.width - r.w, p.x - movingProtection.dx));
    r.y = Math.max(0, Math.min(img.height - r.h, p.y - movingProtection.dy));
    movingProtection.moved = true;
    drawSheet();
    return;
  }
  if (protectionDrag) {
    const p = sheetPos(e);
    protectionDrag.x2 = p.x;
    protectionDrag.y2 = p.y;
    drawSheet();
    return;
  }
  if (moving && img) {
    const p = sheetPos(e);
    const r = rects[moving.i];
    r.x = Math.max(0, Math.min(img.width - r.w, p.x - moving.dx));
    r.y = Math.max(0, Math.min(img.height - r.h, p.y - moving.dy));
    moving.moved = true;
    drawSheet();
    return;
  }
  if (drag) {
    const p = sheetPos(e);
    drag.x2 = p.x;
    drag.y2 = p.y;
    drawSheet();
    return;
  }
  // Hover feedback: a frame is grabbable (move), blank area draws (crosshair).
  if (viewMode === 'source' && img) {
    const p = sheetPos(e);
    if (protectingKeyColor) {
      sheet.style.cursor = protectionAtIndex(p.x, p.y) >= 0 ? 'move' : 'crosshair';
    } else if (mode === 'rects') {
      sheet.style.cursor = rectAtIndex(p.x, p.y) >= 0 ? 'move' : 'crosshair';
    } else {
      sheet.style.cursor = 'default';
    }
  }
});
window.addEventListener('mouseup', () => {
  if (movingProtection) {
    const moved = movingProtection.moved;
    movingProtection = null;
    if (moved) protectionChanged();
    else drawSheet();
    return;
  }
  if (protectionDrag) {
    const d = protectionDrag;
    const r = normRect(d);
    protectionDrag = null;
    if (r.w >= 1 && r.h >= 1) {
      protectedRects.push(r);
    } else {
      const size = Math.max(1, Math.round(num('protectSize')) || 24);
      const half = Math.floor(size / 2);
      const iw = img?.width ?? size;
      const ih = img?.height ?? size;
      protectedRects.push({
        x: Math.max(0, Math.min(iw - size, d.x - half)),
        y: Math.max(0, Math.min(ih - size, d.y - half)),
        w: Math.min(size, iw),
        h: Math.min(size, ih),
      });
    }
    protectionChanged();
    return;
  }
  if (moving) {
    const m = moving;
    moving = null;
    if (m.moved) {
      invalidateApprovals();
      buildRectList();
      syncIO();
    }   // committed a reposition
    drawSheet();                                   // a plain click on a frame just redraws
    return;
  }
  if (!drag) return;
  const d = drag;
  drag = null;
  const r = normRect(d);
  if (r.w >= 2 && r.h >= 2) {
    rects.push(r);                          // a deliberate drag → custom-sized frame
  } else {
    rects.push(placedRect(d.x, d.y));       // a tap on blank area → default-sized frame
  }
  offsets.push({ x: 0, y: 0 });
  invalidateApprovals();
  buildRectList();
  buildAlignmentList();
  syncIO();
  drawSheet();
});

$('btnAddRect').onclick = () => {
  if (!img) { flash('load a sheet first'); return; }
  rects.push(placedRect(0, 0));             // add by coordinates — edit x/y/w/h in the list
  offsets.push({ x: 0, y: 0 });
  invalidateApprovals();
  buildRectList();
  buildAlignmentList();
  syncIO();
  drawSheet();
};

function buildRectList(): void {
  const host = $('rectList');
  host.innerHTML = '';
  rects.forEach((r, i) => {
    const row = document.createElement('div');
    row.className = 'row';
    row.style.cssText = 'display:flex;gap:3px;align-items:center;margin:2px 0';
    row.innerHTML = `<span style="width:16px;color:#ffcd75">${i}</span>`;
    (['x', 'y', 'w', 'h'] as const).forEach((k) => {
      const inp = document.createElement('input');
      inp.type = 'number';
      inp.value = String(r[k]);
      inp.style.width = '46px';
      inp.title = k;
      inp.onchange = () => {
        r[k] = Number(inp.value) || 0;
        invalidateApprovals();
        buildAlignmentList();
        drawSheet();
        syncIO();
      };
      row.appendChild(inp);
    });
    const del = document.createElement('button');
    del.textContent = '×';
    del.onclick = () => {
      rects.splice(i, 1);
      offsets.splice(i, 1);
      invalidateApprovals();
      buildRectList();
      buildAlignmentList();
      drawSheet();
      syncIO();
    };
    row.appendChild(del);
    host.appendChild(row);
  });
}

function ensureOffsets(): void {
  const count = normalizedFrameCount();
  while (offsets.length < count) offsets.push({ x: 0, y: 0 });
  offsets.length = count;
}

function usedFrameIndices(): number[] {
  const limit = frameCount();
  return [...new Set(Object.values(anims).flatMap((anim) => anim.frames))]
    .filter((i) => Number.isInteger(i) && i >= 0 && i < limit)
    .sort((a, b) => a - b);
}

function normalizedFrameCount(): number {
  const used = usedFrameIndices();
  return used.length ? used[used.length - 1] + 1 : Math.min(1, frameCount());
}

function buildAlignmentList(): void {
  ensureOffsets();
  const host = $('alignmentList');
  host.innerHTML = '';
  for (const i of usedFrameIndices()) {
    const offset = offsets[i] ?? (offsets[i] = { x: 0, y: 0 });
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:4px;align-items:center;margin:2px 0';
    row.innerHTML = `<span style="width:22px;color:#ffcd75">${i}</span><span>x</span>`;
    const x = document.createElement('input');
    x.type = 'number'; x.value = String(offset.x); x.style.width = '48px';
    const yLabel = document.createElement('span'); yLabel.textContent = 'y';
    const y = document.createElement('input');
    y.type = 'number'; y.value = String(offset.y); y.style.width = '48px';
    const commit = () => {
      offset.x = Number(x.value) || 0;
      offset.y = Number(y.value) || 0;
      invalidateApprovals();
      syncIO();
    };
    x.onchange = y.onchange = commit;
    row.append(x, yLabel, y);
    host.appendChild(row);
  }
}

/**
 * Place every crop on one shared transparent cell. Bottom-center is the
 * default origin; offsets are the deliberate per-frame correction. This is
 * the palette-limited image-stage artifact that gets approved and exported.
 */
const sourceColorDistance = (
  data: Uint8ClampedArray,
  a: number,
  b: number,
): number => Math.max(
  Math.abs(data[a] - data[b]),
  Math.abs(data[a + 1] - data[b + 1]),
  Math.abs(data[a + 2] - data[b + 2]),
);

function drawCoverageFrame(
  source: ImageData,
  crop: SheetRect,
  destination: ImageData,
  destX: number,
  destY: number,
  destW: number,
  destH: number,
): void {
  const src = source.data;
  const out = destination.data;
  for (let dy = 0; dy < destH; dy += 1) {
    const sy0 = crop.y + dy * crop.h / destH;
    const sy1 = crop.y + (dy + 1) * crop.h / destH;
    for (let dx = 0; dx < destW; dx += 1) {
      const sx0 = crop.x + dx * crop.w / destW;
      const sx1 = crop.x + (dx + 1) * crop.w / destW;
      let alphaArea = 0;
      let red = 0, green = 0, blue = 0;
      for (let sy = Math.floor(sy0); sy < Math.ceil(sy1); sy += 1) {
        if (sy < 0 || sy >= source.height) continue;
        const overlapY = Math.max(0, Math.min(sy + 1, sy1) - Math.max(sy, sy0));
        for (let sx = Math.floor(sx0); sx < Math.ceil(sx1); sx += 1) {
          if (sx < 0 || sx >= source.width) continue;
          const overlapX = Math.max(0, Math.min(sx + 1, sx1) - Math.max(sx, sx0));
          const sourceOffset = (sy * source.width + sx) * 4;
          const weight = overlapX * overlapY * src[sourceOffset + 3] / 255;
          alphaArea += weight;
          red += src[sourceOffset] * weight;
          green += src[sourceOffset + 1] * weight;
          blue += src[sourceOffset + 2] * weight;
        }
      }
      const footprint = (sx1 - sx0) * (sy1 - sy0);
      // Retain a cluster when it owns at least a third of the destination
      // pixel. Nearest-neighbor sampled one arbitrary point and could erase a
      // whole one-pixel eye or outline depending on crop phase.
      if (!alphaArea || alphaArea / footprint < 0.34) continue;
      const targetX = destX + dx;
      const targetY = destY + dy;
      if (targetX < 0 || targetY < 0
        || targetX >= destination.width || targetY >= destination.height) continue;
      const targetOffset = (targetY * destination.width + targetX) * 4;
      out[targetOffset] = Math.round(red / alphaArea);
      out[targetOffset + 1] = Math.round(green / alphaArea);
      out[targetOffset + 2] = Math.round(blue / alphaArea);
      out[targetOffset + 3] = 255;
    }
  }
}

/**
 * Reduction can discard a sparse edge row even when the source crop itself is
 * bottom-aligned. Move the completed sheet as one unit so the lowest surviving
 * subject pixel becomes the shared ground line without introducing per-frame
 * animation jitter.
 */
function anchorNormalizedSheetToBottom(canvas: HTMLCanvasElement, frameH: number): void {
  const ctx = canvas.getContext('2d')!;
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  let lowestOpaqueY = -1;
  for (let y = frameH - 1; y >= 0 && lowestOpaqueY < 0; y -= 1) {
    for (let x = 0; x < canvas.width; x += 1) {
      if (image.data[(y * canvas.width + x) * 4 + 3] !== 0) {
        lowestOpaqueY = y;
        break;
      }
    }
  }
  const shiftY = frameH - 1 - lowestOpaqueY;
  if (lowestOpaqueY < 0 || shiftY <= 0) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.putImageData(image, 0, shiftY);
}

/**
 * Fit one union content box across every frame, then apply an explicit shared
 * crop. The frames keep identical cells and relative motion; unlike changing
 * target dimensions this never rescales the approved pixels.
 */
function fitSharedContentBounds(
  canvas: HTMLCanvasElement,
  frameW: number,
  frameH: number,
): { canvas: HTMLCanvasElement; frameW: number; frameH: number } {
  const ctx = canvas.getContext('2d')!;
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const frameCount = Math.max(1, Math.round(canvas.width / frameW));
  let left = frameW;
  let right = -1;
  let top = frameH;
  let bottom = -1;
  for (let frame = 0; frame < frameCount; frame += 1) {
    const frameX = frame * frameW;
    for (let y = 0; y < frameH; y += 1) {
      for (let x = 0; x < frameW; x += 1) {
        if (image.data[(y * canvas.width + frameX + x) * 4 + 3] === 0) continue;
        left = Math.min(left, x);
        right = Math.max(right, x);
        top = Math.min(top, y);
        bottom = Math.max(bottom, y);
      }
    }
  }
  if (right < left || bottom < top) return { canvas, frameW, frameH };
  const trimTop = Math.max(0, Math.round(num('sharedTrimTop')));
  const trimRight = Math.max(0, Math.round(num('sharedTrimRight')));
  const trimBottom = Math.max(0, Math.round(num('sharedTrimBottom')));
  const trimLeft = Math.max(0, Math.round(num('sharedTrimLeft')));
  left = Math.min(right, left + trimLeft);
  right = Math.max(left, right - trimRight);
  top = Math.min(bottom, top + trimTop);
  bottom = Math.max(top, bottom - trimBottom);
  const fittedFrameW = right - left + 1;
  const fittedFrameH = bottom - top + 1;
  const fitted = document.createElement('canvas');
  fitted.width = fittedFrameW * frameCount;
  fitted.height = fittedFrameH;
  const fittedCtx = fitted.getContext('2d')!;
  for (let frame = 0; frame < frameCount; frame += 1) {
    const pixels = ctx.getImageData(frame * frameW + left, top, fittedFrameW, fittedFrameH);
    fittedCtx.putImageData(pixels, frame * fittedFrameW, 0);
  }
  return { canvas: fitted, frameW: fittedFrameW, frameH: fittedFrameH };
}

interface NormalizedPlacement {
  r: SheetRect;
  drawW: number;
  drawH: number;
  x: number;
  y: number;
}

function projectedProtectionRects(placements: NormalizedPlacement[]): SheetRect[] {
  const projected: SheetRect[] = [];
  for (const placement of placements) {
    for (const protectedRect of protectedRects) {
      const left = Math.max(placement.r.x, protectedRect.x);
      const top = Math.max(placement.r.y, protectedRect.y);
      const right = Math.min(placement.r.x + placement.r.w, protectedRect.x + protectedRect.w);
      const bottom = Math.min(placement.r.y + placement.r.h, protectedRect.y + protectedRect.h);
      if (right <= left || bottom <= top) continue;
      const x = placement.x + Math.floor((left - placement.r.x) * placement.drawW / placement.r.w);
      const y = placement.y + Math.floor((top - placement.r.y) * placement.drawH / placement.r.h);
      const x2 = placement.x + Math.ceil((right - placement.r.x) * placement.drawW / placement.r.w);
      const y2 = placement.y + Math.ceil((bottom - placement.r.y) * placement.drawH / placement.r.h);
      projected.push({ x, y, w: Math.max(1, x2 - x), h: Math.max(1, y2 - y) });
    }
  }
  return projected;
}

function preserveProtectedKeyColors(
  source: ImageData,
  placements: NormalizedPlacement[],
  canvas: HTMLCanvasElement,
): void {
  if (!protectedRects.length) return;
  const keyHex = ($('keyColor') as HTMLInputElement).value;
  const key = [1, 3, 5].map((i) => Number.parseInt(keyHex.slice(i, i + 2), 16));
  const tolerance = Math.max(0, num('keyTolerance'));
  const destinationCtx = canvas.getContext('2d')!;
  const destination = destinationCtx.getImageData(0, 0, canvas.width, canvas.height);
  const preserved = new Map<number, { r: number; g: number; b: number; weight: number }>();

  for (const placement of placements) {
    for (const protectedRect of protectedRects) {
      const left = Math.max(placement.r.x, protectedRect.x);
      const top = Math.max(placement.r.y, protectedRect.y);
      const right = Math.min(placement.r.x + placement.r.w, protectedRect.x + protectedRect.w);
      const bottom = Math.min(placement.r.y + placement.r.h, protectedRect.y + protectedRect.h);
      if (right <= left || bottom <= top) continue;
      for (let sy = Math.floor(top); sy < Math.ceil(bottom); sy += 1) {
        for (let sx = Math.floor(left); sx < Math.ceil(right); sx += 1) {
          const sourceOffset = (sy * source.width + sx) * 4;
          const alpha = source.data[sourceOffset + 3] / 255;
          if (alpha < 0.5) continue;
          const r = source.data[sourceOffset];
          const g = source.data[sourceOffset + 1];
          const b = source.data[sourceOffset + 2];
          const distance = Math.max(Math.abs(r - key[0]), Math.abs(g - key[1]), Math.abs(b - key[2]));
          // A protection region says colors near the reserved key are real
          // subject colors. Carry those pixels through reduction instead of
          // letting surrounding skin or outline average them away.
          if (distance > tolerance + 128) continue;
          const dx = placement.x + Math.floor((sx + 0.5 - placement.r.x) * placement.drawW / placement.r.w);
          const dy = placement.y + Math.floor((sy + 0.5 - placement.r.y) * placement.drawH / placement.r.h);
          if (dx < 0 || dy < 0 || dx >= destination.width || dy >= destination.height) continue;
          const index = dy * destination.width + dx;
          const entry = preserved.get(index) ?? { r: 0, g: 0, b: 0, weight: 0 };
          entry.r += r * alpha;
          entry.g += g * alpha;
          entry.b += b * alpha;
          entry.weight += alpha;
          preserved.set(index, entry);
        }
      }
    }
  }

  for (const [index, color] of preserved) {
    const offset = index * 4;
    destination.data[offset] = Math.round(color.r / color.weight);
    destination.data[offset + 1] = Math.round(color.g / color.weight);
    destination.data[offset + 2] = Math.round(color.b / color.weight);
    destination.data[offset + 3] = 255;
  }
  destinationCtx.putImageData(destination, 0, 0);
}

function lockProtectedPixelsAcrossFrames(
  canvas: HTMLCanvasElement,
  semanticRects: SheetRect[],
  frameCount: number,
): void {
  if (!(($('lockProtectedPixels') as HTMLInputElement).checked)
    || frameCount < 2 || semanticRects.length !== frameCount) return;
  const reference = semanticRects[0];
  const ctx = canvas.getContext('2d')!;
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const referencePixels = new Uint8ClampedArray(reference.w * reference.h * 4);
  for (let y = 0; y < reference.h; y += 1) {
    for (let x = 0; x < reference.w; x += 1) {
      const sourceOffset = ((reference.y + y) * image.width + reference.x + x) * 4;
      referencePixels.set(image.data.subarray(sourceOffset, sourceOffset + 4), (y * reference.w + x) * 4);
    }
  }
  for (const target of semanticRects.slice(1)) {
    for (let y = 0; y < target.h; y += 1) {
      for (let x = 0; x < target.w; x += 1) {
        const sourceX = Math.min(reference.w - 1, Math.floor(x * reference.w / target.w));
        const sourceY = Math.min(reference.h - 1, Math.floor(y * reference.h / target.h));
        const sourceOffset = (sourceY * reference.w + sourceX) * 4;
        const targetOffset = ((target.y + y) * image.width + target.x + x) * 4;
        image.data.set(referencePixels.subarray(sourceOffset, sourceOffset + 4), targetOffset);
      }
    }
  }
  ctx.putImageData(image, 0, 0);
}

function quantizeNormalizedPixels(canvas: HTMLCanvasElement, semanticRects: SheetRect[]): void {
  const ctx = canvas.getContext('2d')!;
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const samples: number[][] = [];
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const p = (y * image.width + x) * 4;
      if (image.data[p + 3] < 128) continue;
      let contrast = 0;
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= image.width || ny >= image.height) continue;
        const neighbor = (ny * image.width + nx) * 4;
        if (image.data[neighbor + 3] < 128) continue;
        contrast = Math.max(contrast, sourceColorDistance(image.data, p, neighbor));
      }
      // Palette selection still accounts for area, but bounded internal
      // features receive enough votes to compete with broad flat clothing.
      const weight = 1 + Math.min(7, Math.floor(contrast / 32));
      for (let i = 0; i < weight; i += 1) {
        samples.push([image.data[p], image.data[p + 1], image.data[p + 2]]);
      }
    }
  }
  if (!samples.length) return;
  const maxColors = Math.max(2, Math.min(CHARS.length, num('maxColors') || 32));
  const semanticSamples: number[][] = [];
  for (const rect of semanticRects) {
    for (let y = Math.max(0, rect.y); y < Math.min(image.height, rect.y + rect.h); y += 1) {
      for (let x = Math.max(0, rect.x); x < Math.min(image.width, rect.x + rect.w); x += 1) {
        const p = (y * image.width + x) * 4;
        if (image.data[p + 3] >= 128) {
          semanticSamples.push([image.data[p], image.data[p + 1], image.data[p + 2]]);
        }
      }
    }
  }
  const semanticColors = semanticSamples.length
    ? buildPalette(semanticSamples, Math.min(6, maxColors)).centers
    : [];
  const palette = buildPalette(samples, maxColors, semanticColors);
  for (let p = 0; p < image.data.length; p += 4) {
    if (image.data[p + 3] < 128) {
      image.data[p] = 0;
      image.data[p + 1] = 0;
      image.data[p + 2] = 0;
      image.data[p + 3] = 0;
      continue;
    }
    const key = palette.charFor(image.data[p], image.data[p + 1], image.data[p + 2]);
    const color = palette.palette[key];
    image.data[p] = Number.parseInt(color.slice(1, 3), 16);
    image.data[p + 1] = Number.parseInt(color.slice(3, 5), 16);
    image.data[p + 2] = Number.parseInt(color.slice(5, 7), 16);
    image.data[p + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
}

function normalizedSheet(): { canvas: HTMLCanvasElement; frameW: number; frameH: number } | null {
  if (normalizedCache) return normalizedCache;
  const src = sourceImage();
  const count = normalizedFrameCount();
  if (!src || !count) return null;
  ensureOffsets();
  const frames = Array.from({ length: count }, (_, i) => rectOf(i));
  const naturalW = Math.max(...frames.map((r) => r.w));
  const naturalH = Math.max(...frames.map((r) => r.h));
  const wantedW = Math.max(0, Math.round(num('targetW')));
  const wantedH = Math.max(0, Math.round(num('targetH')));
  const scale = wantedW || wantedH
    ? Math.min(wantedW ? wantedW / naturalW : Infinity, wantedH ? wantedH / naturalH : Infinity)
    : 1;
  const frameW = wantedW || Math.max(1, Math.round(naturalW * scale));
  const frameH = wantedH || Math.max(1, Math.round(naturalH * scale));
  const canvas = document.createElement('canvas');
  canvas.width = frameW * frames.length;
  canvas.height = frameH;
  const ctx = canvas.getContext('2d')!;
  const placements: NormalizedPlacement[] = frames.map((r, i) => {
    const offset = offsets[i] ?? { x: 0, y: 0 };
    const drawW = Math.max(1, Math.round(r.w * scale));
    const drawH = Math.max(1, Math.round(r.h * scale));
    return {
      r,
      drawW,
      drawH,
      x: i * frameW + Math.round((frameW - drawW) / 2) + offset.x,
      y: frameH - drawH + offset.y,
    };
  });
  const sourceCanvas = document.createElement('canvas');
  sourceCanvas.width = img!.width;
  sourceCanvas.height = img!.height;
  const sourceCtx = sourceCanvas.getContext('2d')!;
  sourceCtx.drawImage(src, 0, 0);
  const sourceData = sourceCtx.getImageData(0, 0, sourceCanvas.width, sourceCanvas.height);
  const resampleMode = ($('resampleMode') as HTMLSelectElement).value;
  if (resampleMode === 'coverage') {
    const destination = ctx.createImageData(canvas.width, canvas.height);
    for (const placement of placements) {
      drawCoverageFrame(
        sourceData,
        placement.r,
        destination,
        placement.x,
        placement.y,
        placement.drawW,
        placement.drawH,
      );
    }
    ctx.putImageData(destination, 0, 0);
  } else {
    ctx.imageSmoothingEnabled = false;
    for (const placement of placements) {
      ctx.drawImage(
        src,
        placement.r.x,
        placement.r.y,
        placement.r.w,
        placement.r.h,
        placement.x,
        placement.y,
        placement.drawW,
        placement.drawH,
      );
    }
  }
  const semanticRects = projectedProtectionRects(placements);
  preserveProtectedKeyColors(sourceData, placements, canvas);
  lockProtectedPixelsAcrossFrames(canvas, semanticRects, placements.length);
  quantizeNormalizedPixels(canvas, semanticRects);
  anchorNormalizedSheetToBottom(canvas, frameH);
  normalizedCache = ($('trimTransparent') as HTMLInputElement).checked
    ? fitSharedContentBounds(canvas, frameW, frameH)
    : { canvas, frameW, frameH };
  return normalizedCache;
}

/* ---------------- sheet view with numbered frames ---------------- */

function drawSheet(): void {
  if (!img) return;
  const normalized = viewMode === 'normalized' ? normalizedSheet() : null;
  const displayW = normalized?.canvas.width ?? img.width;
  const displayH = normalized?.canvas.height ?? img.height;
  sheet.width = displayW * zoom;
  sheet.height = displayH * zoom;
  sctx.imageSmoothingEnabled = false;
  sctx.clearRect(0, 0, sheet.width, sheet.height);
  const src = normalized?.canvas ?? sourceImage();
  if (src) sctx.drawImage(src, 0, 0, sheet.width, sheet.height);

  const n = normalized ? normalizedFrameCount() : frameCount();
  sctx.lineWidth = 1;
  const fontPx = Math.min(18, Math.max(10, Math.round(3.2 * zoom)));
  sctx.font = `${fontPx}px monospace`;
  sctx.textBaseline = 'top';
  for (let i = 0; i < n; i++) {
    const r = normalized
      ? { x: i * normalized.frameW, y: 0, w: normalized.frameW, h: normalized.frameH }
      : rectOf(i);
    if (!r || r.w <= 0 || r.h <= 0) continue;
    const x = r.x * zoom, y = r.y * zoom;
    sctx.strokeStyle = 'rgba(255,205,117,0.8)';
    // Keep the one-pixel border inside the bitmap. Using the full dimensions
    // after the half-pixel alignment placed the bottom and final right edge
    // outside the canvas, where they were clipped.
    sctx.strokeRect(
      x + 0.5,
      y + 0.5,
      Math.max(0, r.w * zoom - 1),
      Math.max(0, r.h * zoom - 1),
    );
    // Index badge sized to the label so multi-digit numbers aren't clipped.
    const label = String(i);
    const pad = 3;
    const tw = Math.ceil(sctx.measureText(label).width);
    sctx.fillStyle = 'rgba(7,7,13,0.78)';
    sctx.fillRect(x + 1, y + 1, tw + pad * 2, fontPx + 3);
    sctx.fillStyle = '#ffcd75';
    sctx.fillText(label, x + 1 + pad, y + 2);
  }
  // In-progress drag.
  if (!normalized && drag) {
    const r = normRect(drag);
    sctx.strokeStyle = '#38b764';
    sctx.setLineDash([4, 3]);
    sctx.strokeRect(r.x * zoom + 0.5, r.y * zoom + 0.5, r.w * zoom, r.h * zoom);
    sctx.setLineDash([]);
  }
  if (!normalized) {
    for (const r of protectedRects) {
      sctx.fillStyle = 'rgba(115,239,247,0.14)';
      sctx.fillRect(r.x * zoom, r.y * zoom, r.w * zoom, r.h * zoom);
      sctx.strokeStyle = '#73eff7';
      sctx.setLineDash([3, 2]);
      sctx.strokeRect(r.x * zoom + 0.5, r.y * zoom + 0.5, r.w * zoom, r.h * zoom);
      sctx.setLineDash([]);
    }
    if (protectionDrag) {
      const r = normRect(protectionDrag);
      sctx.fillStyle = 'rgba(115,239,247,0.18)';
      sctx.fillRect(r.x * zoom, r.y * zoom, r.w * zoom, r.h * zoom);
      sctx.strokeStyle = '#73eff7';
      sctx.strokeRect(r.x * zoom + 0.5, r.y * zoom + 0.5, r.w * zoom, r.h * zoom);
    }
  }
}

/* ---------------- animations ui ---------------- */

function buildAnims(): void {
  const host = $('anims');
  host.innerHTML = '';
  for (const name of Object.keys(anims)) {
    const a = anims[name];
    const box = document.createElement('div');
    box.className = 'anim';
    box.innerHTML = `
      <div class="row"><span>name</span><input data-k="name" type="text" value="${name}"></div>
      <div class="row"><span>frames</span><input data-k="frames" type="text" value="${a.frames.join(',')}" placeholder="0,1,2,3"></div>
      <div class="row"><span>fps</span><input data-k="fps" type="number" min="1" value="${a.fps}" style="width:56px">
        <button data-k="del" style="margin-left:auto">del</button></div>`;
    const nameI = box.querySelector('[data-k=name]') as HTMLInputElement;
    const framesI = box.querySelector('[data-k=frames]') as HTMLInputElement;
    const fpsI = box.querySelector('[data-k=fps]') as HTMLInputElement;
    const commit = () => {
      const frames = framesI.value.split(',').map((s) => Number(s.trim())).filter((v) => Number.isFinite(v));
      const nn = nameI.value.trim() || name;
      if (nn !== name) delete anims[name];
      anims[nn] = { frames, fps: Number(fpsI.value) || 1 };
      invalidateApprovals();
      buildAlignmentList();
      syncIO();
      if (nn !== name) buildAnims();
    };
    framesI.onchange = commit;
    fpsI.onchange = commit;
    nameI.onchange = commit;
    (box.querySelector('[data-k=del]') as HTMLButtonElement).onclick = () => {
      if (Object.keys(anims).length <= 1) return;
      delete anims[name];
      invalidateApprovals();
      buildAnims();
      buildAlignmentList();
      syncIO();
    };
    host.appendChild(box);
  }
}

$('btnAddAnim').onclick = () => {
  const name = prompt('animation name:', '')?.trim();
  if (!name || anims[name]) return;
  anims[name] = { frames: [0], fps: 6 };
  invalidateApprovals();
  buildAnims();
  buildAlignmentList();
  syncIO();
};

/* ---------------- preview (every anim, following the active stage) ---------------- */

function descriptor(): SheetDescriptor {
  const normalized = normalizedSheet();
  if (normalized) {
    return {
      image: imageName.replace(/\.[^.]+$/, '') + '.normalized.png',
      frameW: normalized.frameW,
      frameH: normalized.frameH,
      margin: 0,
      spacing: 0,
      texel: grid().texel,
      anims,
    };
  }
  const g = grid();
  const base = { image: imageName, texel: g.texel, anims } as SheetDescriptor;
  if (mode === 'rects') return { ...base, frameW: 0, frameH: 0, rects };
  return { ...base, frameW: g.frameW, frameH: g.frameH, margin: g.margin, spacing: g.spacing };
}

function renderPreview(): void {
  requestAnimationFrame(renderPreview);
  if (!img) return;
  const normalized = viewMode === 'normalized' ? normalizedSheet() : null;
  const source = normalized?.canvas ?? sourceImage();
  if (!source) return;
  $('previewStage').textContent = normalized ? 'normalized pixels' : 'generated source';
  const names = Object.keys(anims);
  const t = ($('playing') as HTMLInputElement).checked ? performance.now() / 1000 : 0;
  const frameRect = (index: number): SheetRect | null => {
    if (index < 0 || index >= frameCount()) return null;
    return normalized
      ? { x: index * normalized.frameW, y: 0, w: normalized.frameW, h: normalized.frameH }
      : rectOf(index);
  };
  const maxFrameW = Math.max(1, ...usedFrameIndices().map((i) => frameRect(i)?.w ?? 1));
  const maxFrameH = Math.max(1, ...usedFrameIndices().map((i) => frameRect(i)?.h ?? 1));
  const rowH = Math.ceil(maxFrameH * previewZoom) + 26;
  preview.width = Math.max(238, Math.ceil(maxFrameW * previewZoom) + 16);
  preview.height = Math.max(90, names.length * rowH + 8);
  pctx.imageSmoothingEnabled = false;
  pctx.fillStyle = '#0a0c1c';
  pctx.fillRect(0, 0, preview.width, preview.height);
  let y = 6;
  for (const name of names) {
    const a = anims[name];
    pctx.fillStyle = '#94b0c2';
    pctx.font = '11px monospace';
    pctx.fillText(`${name}  ${a.fps}fps  ${normalized ? 'normalized' : 'source'}`, 6, y + 9);
    if (a.frames.length) {
      const idx = Math.floor(t * (a.fps || 1)) % a.frames.length;
      const frame = frameRect(a.frames[idx]);
      if (!frame) { y += rowH; continue; }
      const dw = frame.w * previewZoom, dh = frame.h * previewZoom;
      const baseline = y + rowH - 4;
      if (($('onion') as HTMLInputElement).checked && a.frames.length > 1) {
        const previous = frameRect(a.frames[(idx + a.frames.length - 1) % a.frames.length]);
        if (previous) {
          const previousW = previous.w * previewZoom;
          const previousH = previous.h * previewZoom;
          pctx.globalAlpha = 0.22;
          pctx.drawImage(
            source,
            previous.x, previous.y, previous.w, previous.h,
            8, baseline - previousH, previousW, previousH,
          );
          pctx.globalAlpha = 1;
        }
      }
      pctx.drawImage(source, frame.x, frame.y, frame.w, frame.h, 8, baseline - dh, dw, dh);
    }
    y += rowH;
  }
}

function setPreviewZoom(value: number): void {
  previewZoom = Math.max(0.1, Math.min(12, value));
  $('previewZoomLbl').textContent = `${previewZoom < 1 ? previewZoom.toFixed(2) : previewZoom.toFixed(1)}×`;
  syncUrlState();
}

$('btnPreviewZoomOut').onclick = () => setPreviewZoom(previewZoom / 1.5);
$('btnPreviewZoomIn').onclick = () => setPreviewZoom(previewZoom * 1.5);
$('btnPreviewFit').onclick = () => {
  const normalized = viewMode === 'normalized' ? normalizedSheet() : null;
  const used = usedFrameIndices();
  const widths = used.map((i) => normalized?.frameW ?? rectOf(i)?.w ?? 1);
  const heights = used.map((i) => normalized?.frameH ?? rectOf(i)?.h ?? 1);
  const maxW = Math.max(1, ...widths);
  const maxH = Math.max(1, ...heights);
  const viewport = $('previewViewport');
  setPreviewZoom(Math.min((viewport.clientWidth - 18) / maxW, 260 / maxH));
};

/* ---------------- PNG -> text-grid sprite JSON ---------------- */

// Palette chars a converted sprite may use ('.' is reserved for transparent).
const CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz#@$%&*+='.split('');
const hex2 = (v: number) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0');

interface WeightedColor { r: number; g: number; b: number; count: number }

/**
 * Quantize opaque RGB samples with weighted median cut, then map every source
 * color to its nearest resulting center. Uniform bit buckets put unrelated
 * outline and fabric shades in the same cell, producing dark pepper noise in
 * otherwise flat regions; median cut follows the colors the approved image
 * actually uses.
 */
function buildPalette(
  samples: number[][],
  maxColors: number,
  fixedColors: { r: number; g: number; b: number }[] = [],
) {
  const freq = new Map<string, WeightedColor>();
  for (const [r, g, b] of samples) {
    const k = `${r},${g},${b}`;
    const entry = freq.get(k) ?? { r, g, b, count: 0 };
    entry.count += 1;
    freq.set(k, entry);
  }

  type ColorBox = { colors: WeightedColor[]; count: number; ranges: [number, number, number] };
  const colorBox = (colors: WeightedColor[]): ColorBox => {
    const channels = ([0, 1, 2] as const).map((channel) => {
      const key = (['r', 'g', 'b'] as const)[channel];
      const values = colors.map((color) => color[key]);
      return Math.max(...values) - Math.min(...values);
    }) as [number, number, number];
    return {
      colors,
      count: colors.reduce((sum, color) => sum + color.count, 0),
      ranges: channels,
    };
  };

  const fixed = [...new Map(fixedColors.map((color) => [
    `${color.r},${color.g},${color.b}`,
    { ...color, count: Number.MAX_SAFE_INTEGER },
  ])).values()].slice(0, maxColors);
  const dynamicLimit = Math.max(0, maxColors - fixed.length);
  const boxes = dynamicLimit && freq.size ? [colorBox([...freq.values()])] : [];
  while (boxes.length < dynamicLimit) {
    let splitIndex = -1;
    let splitScore = -1;
    boxes.forEach((box, index) => {
      const score = Math.max(...box.ranges) * Math.sqrt(box.count);
      if (box.colors.length > 1 && score > splitScore) {
        splitIndex = index;
        splitScore = score;
      }
    });
    if (splitIndex < 0) break;
    const box = boxes[splitIndex];
    const channelIndex = box.ranges.indexOf(Math.max(...box.ranges));
    const channel = (['r', 'g', 'b'] as const)[channelIndex];
    const sorted = [...box.colors].sort((a, b) => a[channel] - b[channel]);
    const midpoint = box.count / 2;
    let running = 0;
    let cut = 1;
    for (; cut < sorted.length; cut += 1) {
      running += sorted[cut - 1].count;
      if (running >= midpoint) break;
    }
    boxes.splice(splitIndex, 1, colorBox(sorted.slice(0, cut)), colorBox(sorted.slice(cut)));
  }

  const dynamicCenters = boxes.map((box) => ({
    r: Math.round(box.colors.reduce((sum, color) => sum + color.r * color.count, 0) / box.count),
    g: Math.round(box.colors.reduce((sum, color) => sum + color.g * color.count, 0) / box.count),
    b: Math.round(box.colors.reduce((sum, color) => sum + color.b * color.count, 0) / box.count),
    count: box.count,
  })).sort((a, b) => b.count - a.count);
  const centers = [...new Map([...fixed, ...dynamicCenters].map((color) => [
    `${color.r},${color.g},${color.b}`,
    color,
  ])).values()].slice(0, maxColors);
  if (!centers.length) centers.push({ r: 0, g: 0, b: 0, count: 1 });

  const palette: Record<string, string> = {};
  centers.forEach((center, i) => {
    const ch = CHARS[i];
    palette[ch] = `#${hex2(center.r)}${hex2(center.g)}${hex2(center.b)}`;
  });
  const mapped = new Map<string, string>();
  const charFor = (r: number, g: number, b: number) => {
    const key = `${r},${g},${b}`;
    const cached = mapped.get(key);
    if (cached) return cached;
    let nearest = 0;
    let distance = Infinity;
    centers.forEach((center, index) => {
      const dr = r - center.r, dg = g - center.g, db = b - center.b;
      const candidate = dr * dr * 3 + dg * dg * 4 + db * db * 2;
      if (candidate < distance) { distance = candidate; nearest = index; }
    });
    const resolved = CHARS[nearest];
    mapped.set(key, resolved);
    return resolved;
  };
  return { palette, charFor, centers };
}

/**
 * Read the approved normalized pixels without resampling them again.
 *
 * A 4x-density sheet is already the final art: SpriteFile expresses that as
 * `hd: false`. Downsampling here and letting the loader EPX it back to 4x
 * changes clusters after the image approval gate, so conversion preserves the
 * already palette-limited normalized sheet byte-for-byte.
 */
function frameSpritePixels(): { w: number; h: number; data: Uint8ClampedArray | null }[] {
  const normalized = normalizedSheet();
  if (!normalized) return [];
  const tmp = document.createElement('canvas');
  const tctx = tmp.getContext('2d')!;
  const out: { w: number; h: number; data: Uint8ClampedArray | null }[] = [];
  for (let i = 0; i < normalizedFrameCount(); i++) {
    tmp.width = normalized.frameW; tmp.height = normalized.frameH;
    tctx.imageSmoothingEnabled = false;
    tctx.clearRect(0, 0, tmp.width, tmp.height);
    tctx.drawImage(
      normalized.canvas,
      i * normalized.frameW, 0, normalized.frameW, normalized.frameH,
      0, 0, tmp.width, tmp.height,
    );
    out.push({ w: tmp.width, h: tmp.height, data: tctx.getImageData(0, 0, tmp.width, tmp.height).data });
  }
  return out;
}

/** Convert the sliced frames + animation lists into a text-grid SpriteFile. */
function spriteFile() {
  const texel = grid().texel;
  if (texel !== 1 && texel !== 4) {
    throw new Error('sprite JSON supports texel density 1 or 4');
  }
  const px = frameSpritePixels();
  const maxColors = Math.max(2, Math.min(CHARS.length, num('maxColors') || 32));
  const samples: number[][] = [];
  for (const f of px) {
    if (!f.data) continue;
    for (let p = 0; p < f.w * f.h; p++) {
      if (f.data[p * 4 + 3] >= 128) samples.push([f.data[p * 4], f.data[p * 4 + 1], f.data[p * 4 + 2]]);
    }
  }
  const pal = buildPalette(samples, maxColors);
  const outAnims: Record<string, { fps: number; frames: string[][] }> = {};
  for (const name of Object.keys(anims)) {
    const a = anims[name];
    const frames = a.frames
      .filter((fi) => fi >= 0 && fi < px.length && px[fi].data)
      .map((fi) => {
        const f = px[fi];
        const d = f.data!;
        const rows: string[] = [];
        for (let y = 0; y < f.h; y++) {
          let row = '';
          for (let x = 0; x < f.w; x++) {
            const o = (y * f.w + x) * 4;
            row += d[o + 3] < 128 ? '.' : pal.charFor(d[o], d[o + 1], d[o + 2]);
          }
          rows.push(row);
        }
        return rows;
      });
    outAnims[name] = { fps: a.fps, frames };
  }
  return { hd: texel !== 4, palette: pal.palette, anims: outAnims };
}

/* ---------------- io ---------------- */

interface WorkbenchUrlState {
  v: 1;
  mode: 'grid' | 'rects';
  viewMode: 'source' | 'normalized';
  protectingKeyColor?: boolean;
  zoom: number;
  previewZoom?: number;
  rects: SheetRect[];
  protectedRects?: SheetRect[];
  offsets: { x: number; y: number }[];
  anims: Record<string, { frames: number[]; fps: number }>;
  inputs: Record<string, string>;
  keyEnabled: boolean;
  lockProtectedPixels?: boolean;
  trimTransparent?: boolean;
  playing: boolean;
  onion: boolean;
}

const persistedInputIds = [
  'fw', 'fh', 'margin', 'spacing', 'rw', 'rh', 'texel', 'maxColors',
  'detectPadding', 'keyColor', 'keyTolerance', 'protectSize', 'targetW', 'targetH',
  'resampleMode', 'sharedTrimTop', 'sharedTrimRight', 'sharedTrimBottom', 'sharedTrimLeft',
] as const;

function captureUrlState(): WorkbenchUrlState {
  return {
    v: 1,
    mode,
    viewMode,
    protectingKeyColor,
    zoom,
    previewZoom,
    rects: rects.map((rect) => ({ ...rect })),
    protectedRects: protectedRects.map((rect) => ({ ...rect })),
    offsets: offsets.map((offset) => ({ ...offset })),
    anims: Object.fromEntries(Object.entries(anims).map(([name, anim]) => [name, {
      frames: [...anim.frames],
      fps: anim.fps,
    }])),
    inputs: Object.fromEntries(persistedInputIds.map((id) => [id, ($(id) as HTMLInputElement).value])),
    keyEnabled: ($('keyEnabled') as HTMLInputElement).checked,
    lockProtectedPixels: ($('lockProtectedPixels') as HTMLInputElement).checked,
    trimTransparent: ($('trimTransparent') as HTMLInputElement).checked,
    playing: ($('playing') as HTMLInputElement).checked,
    onion: ($('onion') as HTMLInputElement).checked,
  };
}

function syncUrlState(): void {
  if (!urlSyncReady || !img) return;
  const imageUrl = ($('imageUrl') as HTMLInputElement).value.trim();
  if (!imageUrl) return; // A local upload cannot be reconstructed after refresh.
  const params = new URLSearchParams();
  params.set('image', imageUrl);
  params.set('state', JSON.stringify(captureUrlState()));
  history.replaceState(null, '', `${location.pathname}?${params}`);
}

function parsedUrlState(raw: string | null): WorkbenchUrlState | null {
  if (!raw) return null;
  try {
    const state = JSON.parse(raw) as Partial<WorkbenchUrlState>;
    if (state.v !== 1 || (state.mode !== 'grid' && state.mode !== 'rects')) return null;
    return state as WorkbenchUrlState;
  } catch {
    return null;
  }
}

function restoreUrlState(state: WorkbenchUrlState): void {
  for (const id of persistedInputIds) {
    const value = state.inputs?.[id];
    if (typeof value === 'string') ($(id) as HTMLInputElement).value = value;
  }
  ($('keyEnabled') as HTMLInputElement).checked = !!state.keyEnabled;
  ($('lockProtectedPixels') as HTMLInputElement).checked = state.lockProtectedPixels !== false;
  ($('trimTransparent') as HTMLInputElement).checked = !!state.trimTransparent;
  ($('playing') as HTMLInputElement).checked = state.playing !== false;
  ($('onion') as HTMLInputElement).checked = !!state.onion;
  mode = state.mode;
  viewMode = state.viewMode === 'normalized' ? 'normalized' : 'source';
  protectingKeyColor = !!state.protectingKeyColor;
  zoom = Math.max(0.1, Math.min(16, Number(state.zoom) || 3));
  previewZoom = Math.max(0.1, Math.min(12, Number(state.previewZoom) || 0.75));
  rects = Array.isArray(state.rects) ? state.rects.map((rect) => ({ ...rect })) : [];
  protectedRects = Array.isArray(state.protectedRects)
    ? state.protectedRects.map((rect) => ({ ...rect }))
    : [];
  offsets = Array.isArray(state.offsets) ? state.offsets.map((offset) => ({ ...offset })) : [];
  for (const name of Object.keys(anims)) delete anims[name];
  for (const [name, animation] of Object.entries(state.anims ?? {})) {
    if (!Array.isArray(animation.frames)) continue;
    anims[name] = { frames: [...animation.frames], fps: Number(animation.fps) || 1 };
  }
  if (!Object.keys(anims).length) anims.idle = { frames: [0], fps: 4 };
  prepared = null;
  normalizedCache = null;
  invalidateApprovals();
  ($('gridControls') as HTMLElement).style.display = mode === 'grid' ? '' : 'none';
  ($('rectControls') as HTMLElement).style.display = mode === 'rects' ? '' : 'none';
  $('zoomLbl').textContent = `${zoom < 1 ? zoom.toFixed(2) : zoom.toFixed(1)}×`;
  $('previewZoomLbl').textContent = `${previewZoom < 1 ? previewZoom.toFixed(2) : previewZoom.toFixed(1)}×`;
  buildModeBtns();
  buildViewBtns();
  buildProtectionControls();
  buildProtectionList();
  buildRectList();
  buildAlignmentList();
  buildAnims();
  drawSheet();
  syncIO();
}

function syncIO(): void {
  ($('io') as HTMLTextAreaElement).value = JSON.stringify(descriptor(), null, 2);
  syncUrlState();
}

$('btnExport').onclick = () => {
  syncIO();
  navigator.clipboard?.writeText(($('io') as HTMLTextAreaElement).value);
  flash('descriptor copied to clipboard');
};

$('btnExportPng').onclick = () => {
  const normalized = normalizedSheet();
  if (!normalized) { flash('load and slice an image first'); return; }
  normalized.canvas.toBlob((blob) => {
    if (!blob) { flash('could not encode normalized PNG'); return; }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = imageName.replace(/\.[^.]+$/, '') + '.normalized.png';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 0);
    flash('normalized PNG exported for image-stage approval');
  }, 'image/png');
};

$('btnExportSprite').onclick = () => {
  if (!approvalsReady()) { flash('approve identity, motion, and alignment first'); return; }
  if (!img) { flash('load a sheet first'); return; }
  let sprite: ReturnType<typeof spriteFile>;
  try {
    sprite = spriteFile();
  } catch (error) {
    flash(error instanceof Error ? error.message : String(error));
    return;
  }
  const json = JSON.stringify(sprite, null, 2);
  ($('io') as HTMLTextAreaElement).value = json;
  navigator.clipboard?.writeText(json);
  flash(`sprite json copied (${Object.keys(sprite.palette).length} colors) — paste into the sprite editor`);
};

for (const id of ['playing', 'onion']) {
  ($(id) as HTMLInputElement).onchange = syncUrlState;
}

buildModeBtns();
buildViewBtns();
buildProtectionControls();
buildProtectionList();
buildAnims();
buildRectList();
buildAlignmentList();
updateApprovalGate();
renderPreview();

const params = new URLSearchParams(location.search);
const restoredState = parsedUrlState(params.get('state'));
const requestedImage = params.get('image');
if (requestedImage) {
  ($('imageUrl') as HTMLInputElement).value = requestedImage;
  if (!restoredState) {
    for (const [key, id] of [['targetW', 'targetW'], ['targetH', 'targetH']] as const) {
      const value = params.get(key);
      if (value) ($(id) as HTMLInputElement).value = value;
    }
  }
  loadImageUrl(requestedImage, undefined, () => {
    if (restoredState) restoreUrlState(restoredState);
    urlSyncReady = true;
    syncIO();
  });
} else {
  urlSyncReady = true;
  syncIO();
}
