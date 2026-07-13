import { loadSheet, type SheetDescriptor, type SheetRect } from '@engine/index';

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
let zoom = 3;
/** Explicit per-frame rects (rects mode). */
let rects: SheetRect[] = [];
/** In-progress drag rectangle (image pixel coords). */
let drag: { x: number; y: number; x2: number; y2: number } | null = null;
/** In-progress move of an existing rect: its index + grab offset. */
let moving: { i: number; dx: number; dy: number; moved: boolean } | null = null;
/** anim name -> { frames:number[], fps } */
const anims: Record<string, { frames: number[]; fps: number }> = {
  idle: { frames: [0], fps: 4 },
};

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
      ($('gridControls') as HTMLElement).style.display = m === 'grid' ? '' : 'none';
      ($('rectControls') as HTMLElement).style.display = m === 'rects' ? '' : 'none';
      buildModeBtns();
      drawSheet();
      syncIO();
    };
    host.appendChild(b);
  });
}

/* ---------------- load ---------------- */

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
      img = i;
      flash(`loaded ${f.name} (${i.width}×${i.height})`);
      drawSheet();
      syncIO();
    };
    i.src = String(reader.result);
  };
  reader.readAsDataURL(f);
  input.value = '';
};

for (const id of ['fw', 'fh', 'margin', 'spacing', 'texel']) {
  ($(id) as HTMLInputElement).onchange = () => { drawSheet(); syncIO(); };
}

/* ---------------- zoom ---------------- */

function setZoom(z: number): void {
  zoom = Math.max(1, Math.min(16, z));
  $('zoomLbl').textContent = `${zoom}×`;
  drawSheet();
}
$('btnZoomIn').onclick = () => setZoom(zoom + 1);
$('btnZoomOut').onclick = () => setZoom(zoom - 1);
$('view').addEventListener('wheel', (e) => {
  if (!e.ctrlKey && !e.metaKey) return; // ctrl/cmd + wheel zooms; plain wheel scrolls
  e.preventDefault();
  setZoom(zoom + (e.deltaY < 0 ? 1 : -1));
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
/** A default-sized frame anchored top-left at (x,y), clamped inside the image. */
function placedRect(x: number, y: number): SheetRect {
  const { w, h } = defSize();
  const iw = img ? img.width : w, ih = img ? img.height : h;
  return { x: Math.max(0, Math.min(iw - w, x)), y: Math.max(0, Math.min(ih - h, y)), w, h };
}
sheet.addEventListener('contextmenu', (e) => e.preventDefault());
sheet.addEventListener('mousedown', (e) => {
  if (mode !== 'rects' || !img) return;
  const p = sheetPos(e);
  if (e.button === 2) {
    // Remove the topmost rect under the cursor.
    const hit = rectAtIndex(p.x, p.y);
    if (hit >= 0) {
      rects.splice(hit, 1);
      buildRectList();
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
  if (mode === 'rects' && img) {
    const p = sheetPos(e);
    sheet.style.cursor = rectAtIndex(p.x, p.y) >= 0 ? 'move' : 'crosshair';
  }
});
window.addEventListener('mouseup', () => {
  if (moving) {
    const m = moving;
    moving = null;
    if (m.moved) { buildRectList(); syncIO(); }   // committed a reposition
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
  buildRectList();
  syncIO();
  drawSheet();
});

$('btnAddRect').onclick = () => {
  if (!img) { flash('load a sheet first'); return; }
  rects.push(placedRect(0, 0));             // add by coordinates — edit x/y/w/h in the list
  buildRectList();
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
      inp.onchange = () => { r[k] = Number(inp.value) || 0; drawSheet(); syncIO(); };
      row.appendChild(inp);
    });
    const del = document.createElement('button');
    del.textContent = '×';
    del.onclick = () => { rects.splice(i, 1); buildRectList(); drawSheet(); syncIO(); };
    row.appendChild(del);
    host.appendChild(row);
  });
}

/* ---------------- sheet view with numbered frames ---------------- */

function drawSheet(): void {
  if (!img) return;
  sheet.width = img.width * zoom;
  sheet.height = img.height * zoom;
  sctx.imageSmoothingEnabled = false;
  sctx.clearRect(0, 0, sheet.width, sheet.height);
  sctx.drawImage(img, 0, 0, sheet.width, sheet.height);

  const n = frameCount();
  sctx.lineWidth = 1;
  const fontPx = Math.min(18, Math.max(10, Math.round(3.2 * zoom)));
  sctx.font = `${fontPx}px monospace`;
  sctx.textBaseline = 'top';
  for (let i = 0; i < n; i++) {
    const r = rectOf(i);
    if (!r || r.w <= 0 || r.h <= 0) continue;
    const x = r.x * zoom, y = r.y * zoom;
    sctx.strokeStyle = 'rgba(255,205,117,0.8)';
    sctx.strokeRect(x + 0.5, y + 0.5, r.w * zoom, r.h * zoom);
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
  if (drag) {
    const r = normRect(drag);
    sctx.strokeStyle = '#38b764';
    sctx.setLineDash([4, 3]);
    sctx.strokeRect(r.x * zoom + 0.5, r.y * zoom + 0.5, r.w * zoom, r.h * zoom);
    sctx.setLineDash([]);
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
      syncIO();
      if (nn !== name) buildAnims();
    };
    framesI.onchange = commit;
    fpsI.onchange = commit;
    nameI.onchange = commit;
    (box.querySelector('[data-k=del]') as HTMLButtonElement).onclick = () => {
      if (Object.keys(anims).length <= 1) return;
      delete anims[name];
      buildAnims();
      syncIO();
    };
    host.appendChild(box);
  }
}

$('btnAddAnim').onclick = () => {
  const name = prompt('animation name:', '')?.trim();
  if (!name || anims[name]) return;
  anims[name] = { frames: [0], fps: 6 };
  buildAnims();
  syncIO();
};

/* ---------------- preview (every anim, via loadSheet) ---------------- */

function descriptor(): SheetDescriptor {
  const g = grid();
  const base = { image: imageName, texel: g.texel, anims } as SheetDescriptor;
  if (mode === 'rects') return { ...base, frameW: 0, frameH: 0, rects };
  return { ...base, frameW: g.frameW, frameH: g.frameH, margin: g.margin, spacing: g.spacing };
}

function renderPreview(): void {
  requestAnimationFrame(renderPreview);
  if (!img || !($('playing') as HTMLInputElement).checked) return;
  let loaded;
  try {
    loaded = loadSheet(img, descriptor());
  } catch {
    return;
  }
  const names = Object.keys(anims);
  const t = performance.now() / 1000;
  const rowH = 74;
  preview.width = 240;
  preview.height = Math.max(90, names.length * rowH + 8);
  pctx.imageSmoothingEnabled = false;
  pctx.fillStyle = '#0a0c1c';
  pctx.fillRect(0, 0, preview.width, preview.height);
  let y = 6;
  for (const name of names) {
    const a = anims[name];
    pctx.fillStyle = '#94b0c2';
    pctx.font = '11px monospace';
    pctx.fillText(`${name}  ${a.fps}fps`, 6, y + 9);
    const frames = loaded.frames(name);
    if (frames.length) {
      const idx = Math.floor(t * (a.fps || 1)) % frames.length;
      const f = frames[idx];
      const dw = (f.width / 4) * 3, dh = (f.height / 4) * 3;
      pctx.drawImage(f, 8, y + 12, dw, dh);
    }
    y += rowH;
  }
}

/* ---------------- PNG -> text-grid sprite JSON ---------------- */

// Palette chars a converted sprite may use ('.' is reserved for transparent).
const CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz#@$%&*+='.split('');
const hex2 = (v: number) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0');

/** Quantize a set of RGB samples to at most `maxColors` buckets by dropping
 * low bits until the distinct count fits, then averaging each bucket. */
function buildPalette(samples: number[][], maxColors: number) {
  const freq = new Map<string, { r: number; g: number; b: number; c: number }>();
  for (const [r, g, b] of samples) {
    const k = `${r},${g},${b}`;
    const e = freq.get(k) ?? { r, g, b, c: 0 };
    e.c++; freq.set(k, e);
  }
  const bucketsAt = (sh: number) => {
    const m = new Map<string, { r: number; g: number; b: number; c: number }>();
    for (const { r, g, b, c } of freq.values()) {
      const k = `${r >> sh},${g >> sh},${b >> sh}`;
      const e = m.get(k) ?? { r: 0, g: 0, b: 0, c: 0 };
      e.r += r * c; e.g += g * c; e.b += b * c; e.c += c; m.set(k, e);
    }
    return m;
  };
  let shift = 0;
  let buckets = bucketsAt(0);
  while (buckets.size > maxColors && shift < 8) { shift++; buckets = bucketsAt(shift); }
  const ordered = [...buckets.entries()].sort((a, b) => b[1].c - a[1].c).slice(0, CHARS.length);
  const palette: Record<string, string> = {};
  const keyToChar = new Map<string, string>();
  ordered.forEach(([k, e], i) => {
    const ch = CHARS[i];
    palette[ch] = `#${hex2(Math.round(e.r / e.c))}${hex2(Math.round(e.g / e.c))}${hex2(Math.round(e.b / e.c))}`;
    keyToChar.set(k, ch);
  });
  const charFor = (r: number, g: number, b: number) =>
    keyToChar.get(`${r >> shift},${g >> shift},${b >> shift}`) ?? CHARS[0];
  return { palette, charFor };
}

/** Read each frame's pixels at logical resolution (frame size / texel). */
function frameLogicalPixels(): { w: number; h: number; data: Uint8ClampedArray | null }[] {
  const texel = grid().texel;
  const tmp = document.createElement('canvas');
  const tctx = tmp.getContext('2d')!;
  const out: { w: number; h: number; data: Uint8ClampedArray | null }[] = [];
  for (let i = 0; i < frameCount(); i++) {
    const r = rectOf(i);
    if (!img || !r || r.w <= 0 || r.h <= 0) { out.push({ w: 0, h: 0, data: null }); continue; }
    const lw = Math.max(1, Math.round(r.w / texel)), lh = Math.max(1, Math.round(r.h / texel));
    tmp.width = lw; tmp.height = lh;
    tctx.imageSmoothingEnabled = false;
    tctx.clearRect(0, 0, lw, lh);
    tctx.drawImage(img, r.x, r.y, r.w, r.h, 0, 0, lw, lh);
    out.push({ w: lw, h: lh, data: tctx.getImageData(0, 0, lw, lh).data });
  }
  return out;
}

/** Convert the sliced frames + animation lists into a text-grid SpriteFile. */
function spriteFile() {
  const px = frameLogicalPixels();
  const maxColors = Math.max(2, Math.min(CHARS.length, num('maxColors') || 24));
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
  return { hd: true, palette: pal.palette, anims: outAnims };
}

/* ---------------- io ---------------- */

function syncIO(): void {
  ($('io') as HTMLTextAreaElement).value = JSON.stringify(descriptor(), null, 2);
}

$('btnExport').onclick = () => {
  syncIO();
  navigator.clipboard?.writeText(($('io') as HTMLTextAreaElement).value);
  flash('descriptor copied to clipboard');
};

$('btnExportSprite').onclick = () => {
  if (!img) { flash('load a sheet first'); return; }
  const sprite = spriteFile();
  const json = JSON.stringify(sprite, null, 2);
  ($('io') as HTMLTextAreaElement).value = json;
  navigator.clipboard?.writeText(json);
  flash(`sprite json copied (${Object.keys(sprite.palette).length} colors) — paste into the sprite editor`);
};

buildModeBtns();
buildAnims();
buildRectList();
syncIO();
renderPreview();
