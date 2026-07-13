import { loadSheet, type SheetDescriptor } from '@engine/index';

/**
 * Sprite-sheet slicer: load a PNG, describe its grid, list which frames
 * make up each animation, preview them, and export a SheetDescriptor JSON
 * the game loads with `loadSheet`. This is the bridge for full-colour art
 * that the text-grid sprite format can't express.
 */

const $ = (id: string) => document.getElementById(id)!;
const sheet = $('sheet') as HTMLCanvasElement;
const sctx = sheet.getContext('2d')!;
const preview = $('preview') as HTMLCanvasElement;
const pctx = preview.getContext('2d')!;

let img: HTMLImageElement | null = null;
let imageName = 'sheet.png';
/** anim name -> { frames:number[], fps } */
const anims: Record<string, { frames: number[]; fps: number }> = {
  idle: { frames: [0], fps: 4 },
};
const VIEW_ZOOM = 3;

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
function frameCount(): number {
  if (!img) return 0;
  const g = grid();
  const rows = g.frameH > 0 ? Math.max(1, Math.floor((img.height - g.margin + g.spacing) / (g.frameH + g.spacing))) : 1;
  return cols() * rows;
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

/* ---------------- sheet view with numbered grid ---------------- */

function drawSheet(): void {
  if (!img) return;
  sheet.width = img.width * VIEW_ZOOM;
  sheet.height = img.height * VIEW_ZOOM;
  sctx.imageSmoothingEnabled = false;
  sctx.clearRect(0, 0, sheet.width, sheet.height);
  sctx.drawImage(img, 0, 0, sheet.width, sheet.height);

  const g = grid();
  if (g.frameW <= 0 || g.frameH <= 0) return;
  const c = cols();
  const n = frameCount();
  sctx.strokeStyle = 'rgba(255,205,117,0.7)';
  sctx.fillStyle = '#ffcd75';
  sctx.font = `${10 * VIEW_ZOOM}px monospace`;
  sctx.textBaseline = 'top';
  for (let i = 0; i < n; i++) {
    const cx = i % c, ry = Math.floor(i / c);
    const x = (g.margin + cx * (g.frameW + g.spacing)) * VIEW_ZOOM;
    const y = (g.margin + ry * (g.frameH + g.spacing)) * VIEW_ZOOM;
    sctx.strokeRect(x + 0.5, y + 0.5, g.frameW * VIEW_ZOOM, g.frameH * VIEW_ZOOM);
    sctx.fillStyle = 'rgba(7,7,13,0.7)';
    sctx.fillRect(x + 2, y + 2, 20 * VIEW_ZOOM * 0.6, 12 * VIEW_ZOOM * 0.6);
    sctx.fillStyle = '#ffcd75';
    sctx.fillText(String(i), x + 3, y + 2);
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
  return { image: imageName, frameW: g.frameW, frameH: g.frameH, margin: g.margin, spacing: g.spacing, texel: g.texel, anims };
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
      // TEXEL=4 in the game; show at ~game logical size ×3.
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

buildAnims();
syncIO();
renderPreview();
