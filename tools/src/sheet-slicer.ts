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
  drag = { x: p.x, y: p.y, x2: p.x, y2: p.y };
});
sheet.addEventListener('mousemove', (e) => {
  if (!drag) return;
  const p = sheetPos(e);
  drag.x2 = p.x;
  drag.y2 = p.y;
  drawSheet();
});
window.addEventListener('mouseup', () => {
  if (!drag) return;
  const d = drag;
  drag = null;
  const r = normRect(d);
  if (r.w >= 2 && r.h >= 2) {
    rects.push(r);                          // a deliberate drag → custom-sized frame
  } else if (img && rectAtIndex(d.x, d.y) < 0) {
    rects.push(placedRect(d.x, d.y));       // a tap on blank area → default-sized frame
  } else {
    drawSheet();                            // tap on an existing frame → no-op
    return;
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
  sctx.font = `${Math.max(9, 4 * zoom)}px monospace`;
  sctx.textBaseline = 'top';
  for (let i = 0; i < n; i++) {
    const r = rectOf(i);
    if (!r || r.w <= 0 || r.h <= 0) continue;
    const x = r.x * zoom, y = r.y * zoom;
    sctx.strokeStyle = 'rgba(255,205,117,0.8)';
    sctx.strokeRect(x + 0.5, y + 0.5, r.w * zoom, r.h * zoom);
    sctx.fillStyle = 'rgba(7,7,13,0.75)';
    sctx.fillRect(x + 1, y + 1, 16, 12);
    sctx.fillStyle = '#ffcd75';
    sctx.fillText(String(i), x + 2, y + 1);
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

/* ---------------- io ---------------- */

function syncIO(): void {
  ($('io') as HTMLTextAreaElement).value = JSON.stringify(descriptor(), null, 2);
}

$('btnExport').onclick = () => {
  syncIO();
  navigator.clipboard?.writeText(($('io') as HTMLTextAreaElement).value);
  flash('descriptor copied to clipboard');
};

buildModeBtns();
buildAnims();
buildRectList();
syncIO();
renderPreview();
