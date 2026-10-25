#!/usr/bin/env node

/**
 * End-to-end Gemini Video -> Sprite Animation pipeline tool.
 *
 * Automates the 4 pipeline stages in one command (~6-8s total):
 *   1. Random-access decode via ffmpeg + SHA-1 uniqueness gate + timestamped contact sheet
 *   2. Subject bounding-box / feet-baseline registration + sparkle cleanup + candidate strip (.png + .json)
 *   3. Official Sprite Animation Workbench (sheet-slicer.html) coverage normalization + review sheet (.png)
 *   4. Merge into target SpriteFile (knight-v2.json) via merge-sprite-animation.mjs + live Sprite Editor refresh
 *
 * Usage:
 *   node tools/import-video-animation.mjs --video <path.mp4> --anim <name> [options]
 *
 * Options:
 *   --video <path>       Path to source MP4 video (required)
 *   --anim <name>        Target animation name, e.g. greatsword-idle, greatsword-run (required)
 *   --frames <n>         Number of frames in the animation (default: 5)
 *   --fps <n>            Playback FPS in game & extraction cadence (default: 4)
 *   --sample-fps <n>     Video extraction FPS (default: same as --fps)
 *   --times <t1,t2,...>  Explicit comma-separated timestamps in seconds (optional; auto-selects best loop if omitted)
 *   --ref-anim <name>    Reference animation in knight-v2.json for anchor/hitbox defaults (default: sword-idle)
 *   --target <path>      Target sprite JSON (default: src/game/content/sprites/knight-v2.json)
 *   --out-dir <path>     Optional extra directory to copy review artifacts into
 *   --no-merge           Stop after generating normalized review artifacts without merging into knight-v2.json
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { deflateSync, inflateSync } from 'node:zlib';
import { chromium } from 'playwright';

const DEFAULT_FFMPEG = 'C:\\Users\\scott\\AppData\\Local\\Microsoft\\WinGet\\Packages\\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\\ffmpeg-9.0-full_build\\bin\\ffmpeg.exe';
const FFMPEG = existsSync(DEFAULT_FFMPEG) ? DEFAULT_FFMPEG : 'ffmpeg';

function parseArgs(argv) {
  const opts = {
    video: '',
    anim: '',
    frames: 5,
    fps: 4,
    sampleFps: 0,
    times: null,
    refAnim: 'sword-idle',
    target: 'src/game/content/sprites/knight-v2.json',
    outDir: '',
    merge: true,
    serverUrl: process.env.SPRITE_EDITOR_URL ?? 'http://localhost:5173',
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--video') opts.video = argv[++i] ?? '';
    else if (a === '--anim') opts.anim = argv[++i] ?? '';
    else if (a === '--frames') opts.frames = Number(argv[++i]);
    else if (a === '--fps') opts.fps = Number(argv[++i]);
    else if (a === '--sample-fps') opts.sampleFps = Number(argv[++i]);
    else if (a === '--times') opts.times = (argv[++i] ?? '').split(',').map((s) => Number(s.trim())).filter(Number.isFinite);
    else if (a === '--ref-anim') opts.refAnim = argv[++i] ?? 'sword-idle';
    else if (a === '--target') opts.target = argv[++i] ?? opts.target;
    else if (a === '--out-dir') opts.outDir = argv[++i] ?? '';
    else if (a === '--no-merge') opts.merge = false;
  }
  if (!opts.sampleFps) opts.sampleFps = opts.fps;
  if (!opts.video || !opts.anim) {
    throw new Error('Usage: node tools/import-video-animation.mjs --video <mp4> --anim <name> [--frames 5] [--fps 4] [--times t1,t2,...]');
  }
  return opts;
}

function decodePng(buf) {
  let offset = 8, width = 0, height = 0, colorType = 2;
  const idatChunks = [];
  while (offset < buf.length) {
    const len = buf.readUInt32BE(offset);
    const type = buf.toString('ascii', offset + 4, offset + 8);
    const data = buf.subarray(offset + 8, offset + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      colorType = data[9];
    } else if (type === 'IDAT') idatChunks.push(data);
    else if (type === 'IEND') break;
    offset += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idatChunks));
  const bpp = colorType === 6 ? 4 : 3;
  const stride = width * bpp;
  const rgba = new Uint8Array(width * height * 4);
  const recon = new Uint8Array(height * stride);
  const paeth = (a, b, c) => {
    const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
    return (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
  };
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)], rowOff = y * (stride + 1) + 1, dstOff = y * stride;
    for (let x = 0; x < stride; x++) {
      const v = raw[rowOff + x];
      const a = x >= bpp ? recon[dstOff + x - bpp] : 0;
      const b = y > 0 ? recon[dstOff - stride + x] : 0;
      const c = y > 0 && x >= bpp ? recon[dstOff - stride + x - bpp] : 0;
      recon[dstOff + x] = (filter === 1 ? v + a : filter === 2 ? v + b : filter === 3 ? v + ((a + b) >> 1) : filter === 4 ? v + paeth(a, b, c) : v) & 255;
    }
    for (let px = 0; px < width; px++) {
      const s = dstOff + px * bpp, d = (y * width + px) * 4;
      rgba[d] = recon[s]; rgba[d + 1] = recon[s + 1]; rgba[d + 2] = recon[s + 2]; rgba[d + 3] = bpp === 4 ? recon[s + 3] : 255;
    }
  }
  return { width, height, rgba };
}

function encodePngRgba(width, height, rgba) {
  const crcTable = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crcTable[n] = c >>> 0;
  }
  const crc32 = (buf) => {
    let c = 0xffffffff;
    for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const typeBuf = Buffer.from(type, 'ascii');
    const crcBuf = Buffer.alloc(4);
    crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
    return Buffer.concat([len, typeBuf, data, crcBuf]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * width * 4, width * 4).copy(raw, y * (width * 4 + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function measureMainSubject(img) {
  const { width: w, height: h, rgba } = img;
  const fg = new Uint8Array(w * h);
  // Ignore outer video border & bottom-right Gemini watermark region
  const xMinStage = Math.round(w * 0.1);
  const xMaxStage = Math.round(w * 0.86);
  const yMinStage = 15;
  const yMaxStage = Math.min(h - 10, 685);
  for (let y = yMinStage; y < yMaxStage; y++) {
    for (let x = xMinStage; x < xMaxStage; x++) {
      const idx = y * w + x;
      const d = idx * 4;
      const r = rgba[d], g = rgba[d + 1], b = rgba[d + 2];
      const isMagentaBg = r >= 165 && b >= 165 && g <= 68;
      const isSparkle = r >= 205 && b >= 205 && (r - g) >= 18 && (b - g) >= 18;
      if (!isMagentaBg && !isSparkle) fg[idx] = 1;
    }
  }
  const visited = new Uint8Array(w * h);
  let bestComp = [];
  for (let y = yMinStage; y < yMaxStage; y++) {
    for (let x = xMinStage; x < xMaxStage; x++) {
      const idx = y * w + x;
      if (!fg[idx] || visited[idx]) continue;
      const q = [idx];
      visited[idx] = 1;
      const comp = [];
      for (let qi = 0; qi < q.length; qi++) {
        const cur = q[qi];
        comp.push(cur);
        const cx = cur % w, cy = (cur / w) | 0;
        if (cx > xMinStage && fg[cur - 1] && !visited[cur - 1]) { visited[cur - 1] = 1; q.push(cur - 1); }
        if (cx < xMaxStage - 1 && fg[cur + 1] && !visited[cur + 1]) { visited[cur + 1] = 1; q.push(cur + 1); }
        if (cy > yMinStage && fg[cur - w] && !visited[cur - w]) { visited[cur - w] = 1; q.push(cur - w); }
        if (cy < yMaxStage - 1 && fg[cur + w] && !visited[cur + w]) { visited[cur + w] = 1; q.push(cur + w); }
      }
      if (comp.length > bestComp.length) bestComp = comp;
    }
  }
  let minX = w, maxX = -1, minY = h, maxY = -1;
  for (const idx of bestComp) {
    const cx = idx % w, cy = (idx / w) | 0;
    if (cx < minX) minX = cx;
    if (cx > maxX) maxX = cx;
    if (cy < minY) minY = cy;
    if (cy > maxY) maxY = cy;
  }
  let feetMinX = w, feetMaxX = -1, headMaxX = -1;
  for (const idx of bestComp) {
    const cx = idx % w, cy = (idx / w) | 0;
    if (cy >= maxY - 20) {
      if (cx < feetMinX) feetMinX = cx;
      if (cx > feetMaxX) feetMaxX = cx;
    }
    // Front edge of hair/face (upper 30% of figure height)
    if (cy >= minY + 10 && cy <= minY + 175) {
      if (cx > headMaxX) headMaxX = cx;
    }
  }
  return {
    minX, maxX, minY, maxY,
    w: maxX - minX + 1,
    h: maxY - minY + 1,
    feetMinX, feetMaxX,
    feetCenterX: Math.round((feetMinX + feetMaxX) / 2),
    headMaxX,
    comp: bestComp,
  };
}

function frameDiff(a, b, x0, y0, w, h) {
  let sum = 0;
  for (let y = y0; y < y0 + h; y += 2) {
    for (let x = x0; x < x0 + w; x += 2) {
      const i = (y * a.width + x) * 4;
      sum += Math.abs(a.rgba[i] - b.rgba[i]) + Math.abs(a.rgba[i + 1] - b.rgba[i + 1]) + Math.abs(a.rgba[i + 2] - b.rgba[i + 2]);
    }
  }
  return sum / ((w / 2) * (h / 2));
}

const FONT = {
  '0': ['111', '101', '101', '101', '111'],
  '1': ['010', '110', '010', '010', '111'],
  '2': ['111', '001', '111', '100', '111'],
  '3': ['111', '001', '111', '001', '111'],
  '4': ['101', '101', '111', '001', '001'],
  '5': ['111', '100', '111', '001', '111'],
  '6': ['111', '100', '111', '101', '111'],
  '7': ['111', '001', '001', '001', '001'],
  '8': ['111', '101', '111', '101', '111'],
  '9': ['111', '101', '111', '001', '111'],
  '.': ['000', '000', '000', '000', '010'],
  's': ['000', '111', '100', '001', '111'],
  '#': ['101', '111', '101', '111', '101'],
  ' ': ['000', '000', '000', '000', '000'],
};

function buildContactSheet(decoded, cropX, cropY, cropW, cropH) {
  const scale = 2;
  const cellW = Math.floor(cropW / scale);
  const cellH = Math.floor(cropH / scale);
  const cols = Math.min(8, decoded.length);
  const rows = Math.ceil(decoded.length / cols);
  const sheetW = cols * cellW;
  const sheetH = rows * cellH;
  const sheetRgba = new Uint8Array(sheetW * sheetH * 4);

  const drawLabel = (ox, oy, text) => {
    for (let by = 0; by < 18; by++) {
      for (let bx = 0; bx < text.length * 8 + 6; bx++) {
        const px = ox + bx, py = oy + by;
        if (px < sheetW && py < sheetH) {
          const i = (py * sheetW + px) * 4;
          sheetRgba[i] = 12; sheetRgba[i + 1] = 14; sheetRgba[i + 2] = 24; sheetRgba[i + 3] = 255;
        }
      }
    }
    for (let c = 0; c < text.length; c++) {
      const glyph = FONT[text[c]] ?? FONT[' '];
      for (let gy = 0; gy < 5; gy++) {
        for (let gx = 0; gx < 3; gx++) {
          if (glyph[gy][gx] !== '1') continue;
          for (let sy = 0; sy < 2; sy++) {
            for (let sx = 0; sx < 2; sx++) {
              const px = ox + 4 + c * 8 + gx * 2 + sx, py = oy + 4 + gy * 2 + sy;
              if (px < sheetW && py < sheetH) {
                const i = (py * sheetW + px) * 4;
                sheetRgba[i] = 255; sheetRgba[i + 1] = 220; sheetRgba[i + 2] = 110; sheetRgba[i + 3] = 255;
              }
            }
          }
        }
      }
    }
  };

  for (const d of decoded) {
    const col = d.idx % cols, row = Math.floor(d.idx / cols);
    const ox = col * cellW, oy = row * cellH;
    for (let y = 0; y < cellH; y++) {
      const sy = Math.min(d.height - 1, Math.max(0, cropY + y * scale));
      for (let x = 0; x < cellW; x++) {
        const sx = Math.min(d.width - 1, Math.max(0, cropX + x * scale));
        const sIdx = (sy * d.width + sx) * 4;
        const dIdx = ((oy + y) * sheetW + (ox + x)) * 4;
        sheetRgba[dIdx] = d.rgba[sIdx];
        sheetRgba[dIdx + 1] = d.rgba[sIdx + 1];
        sheetRgba[dIdx + 2] = d.rgba[sIdx + 2];
        sheetRgba[dIdx + 3] = 255;
      }
    }
    drawLabel(ox + 4, oy + 4, `#${String(d.idx).padStart(2, '0')} ${d.timeSec.toFixed(2)}s`);
  }
  return encodePngRgba(sheetW, sheetH, sheetRgba);
}

const t0 = Date.now();
const opts = parseArgs(process.argv.slice(2));
const tempDir = mkdtempSync(resolve(tmpdir(), `hitstop-video-${opts.anim}-`));

// 1. Decode video frames via ffmpeg
execFileSync(FFMPEG, [
  '-y',
  '-i', opts.video,
  '-vf', `fps=${opts.sampleFps}`,
  '-start_number', '0',
  resolve(tempDir, 'frame_%04d.png'),
], { stdio: 'ignore' });

const frameFiles = readdirSync(tempDir).filter((f) => f.endsWith('.png')).sort();
if (frameFiles.length < opts.frames) {
  throw new Error(`Decoded only ${frameFiles.length} frames at ${opts.sampleFps}fps; need at least ${opts.frames}`);
}

const decoded = frameFiles.map((file, idx) => {
  const img = decodePng(readFileSync(resolve(tempDir, file)));
  const hash = createHash('sha1').update(img.rgba).digest('hex').slice(0, 10);
  const subject = measureMainSubject(img);
  return { idx, timeSec: Number((idx / opts.sampleFps).toFixed(4)), hash, ...img, subject };
});

const uniqueHashes = new Set(decoded.map((d) => d.hash)).size;
if (uniqueHashes < Math.min(3, decoded.length)) {
  throw new Error(`Video random-access decode gate failed: only ${uniqueHashes} unique frame hashes across ${decoded.length} samples`);
}

// 2. Select frame indices (explicit --times or best contiguous N-frame loop)
let selectedIndices = [];
if (opts.times && opts.times.length === opts.frames) {
  selectedIndices = opts.times.map((t) => {
    let best = 0;
    let bestDist = Infinity;
    for (const d of decoded) {
      const dist = Math.abs(d.timeSec - t);
      if (dist < bestDist) { bestDist = dist; best = d.idx; }
    }
    return best;
  });
} else {
  let bestStart = 0;
  let bestScore = Infinity;
  for (let start = 0; start <= decoded.length - opts.frames; start++) {
    const window = decoded.slice(start, start + opts.frames);
    const stepDiffs = [];
    for (let k = 0; k < opts.frames - 1; k++) {
      stepDiffs.push(frameDiff(window[k], window[k + 1], 260, 25, 680, 670));
    }
    const minStep = Math.min(...stepDiffs);
    if (minStep < 8) continue; // skip frozen startup frames
    const loopDiff = frameDiff(window[opts.frames - 1], window[0], 260, 25, 680, 670);
    const maxYs = window.map((w) => w.subject.maxY);
    const baselineRange = Math.max(...maxYs) - Math.min(...maxYs);
    const score = loopDiff * 1.5 + baselineRange * 12;
    if (score < bestScore) {
      bestScore = score;
      bestStart = start;
    }
  }
  selectedIndices = Array.from({ length: opts.frames }, (_, k) => bestStart + k);
}

const selected = selectedIndices.map((i) => decoded[i]);
const medianFeetCenter = selected.map((d) => d.subject.feetCenterX).sort((a, b) => a - b)[Math.floor(selected.length / 2)];
const medianHeadMaxX = selected.map((d) => d.subject.headMaxX).sort((a, b) => a - b)[Math.floor(selected.length / 2)];
const medianMaxY = selected.map((d) => d.subject.maxY).sort((a, b) => a - b)[Math.floor(selected.length / 2)];
const minSubjectX = Math.min(...selected.map((d) => d.subject.minX));
const maxSubjectX = Math.max(...selected.map((d) => d.subject.maxX));

// Match sword-idle / sword-run registration:
// cropH = 671, baseline at localY = 642 (y = 109 in 160x110).
// For locomotion (run), shift cropCenter left by 30px so the leaning character's
// head/torso centers on hitboxOffset x=17 (headMaxX ~ 106..107 in 160x110).
const isRun = opts.anim.includes('run');
const cropH = 671;
const cropY = Math.max(0, Math.min(decoded[0].height - cropH, medianMaxY - 642));
const targetCropCenter = medianFeetCenter - (isRun ? 65 : 35);
const requiredHalfW = Math.max(
  244,
  targetCropCenter - minSubjectX + 24,
  maxSubjectX - targetCropCenter + 24,
);
const cropW = Math.min(decoded[0].width, Math.ceil(requiredHalfW * 2));
const cropX = Math.max(0, Math.min(decoded[0].width - cropW, Math.round(targetCropCenter - cropW / 2)));

// Write contact sheet
const contactBuf = buildContactSheet(decoded, cropX, cropY, cropW, cropH);
const contactPath = resolve('docs/art', `knight-v2-${opts.anim}-video-contact-sheet.png`);
mkdirSync(resolve('docs/art'), { recursive: true });
writeFileSync(contactPath, contactBuf);

// Build cleaned source candidate strip (with per-frame camera-drift stabilization for run)
const sheetW = cropW * selected.length;
const sheetH = cropH;
const sheetRgba = new Uint8Array(sheetW * sheetH * 4);
for (let i = 0; i < sheetW * sheetH * 4; i += 4) {
  sheetRgba[i] = 255;
  sheetRgba[i + 1] = 0;
  sheetRgba[i + 2] = 255;
  sheetRgba[i + 3] = 255;
}

selected.forEach((d, col) => {
  const mainSet = new Set(d.subject.comp);
  // Stabilize horizontal head position while preserving source Y (so airborne
  // run frames keep their natural ground clearance like knight-v2 run).
  const shiftX = isRun ? (medianHeadMaxX - d.subject.headMaxX) : 0;
  const shiftY = 0;
  for (let y = 0; y < cropH; y++) {
    const sy = cropY + y - shiftY;
    if (sy < 0 || sy >= d.height) continue;
    for (let x = 0; x < cropW; x++) {
      const sx = cropX + x - shiftX;
      if (sx < 0 || sx >= d.width) continue;
      const fullIdx = sy * d.width + sx;
      if (!mainSet.has(fullIdx)) continue;
      const sOff = fullIdx * 4;
      const dOff = (y * sheetW + (col * cropW + x)) * 4;
      sheetRgba[dOff] = d.rgba[sOff];
      sheetRgba[dOff + 1] = d.rgba[sOff + 1];
      sheetRgba[dOff + 2] = d.rgba[sOff + 2];
      sheetRgba[dOff + 3] = 255;
    }
  }
});

const sourceCandPng = resolve('docs/art', `knight-v2-${opts.anim}-video-source-candidate-01.png`);
const sourceCandJson = resolve('docs/art', `knight-v2-${opts.anim}-video-source-candidate-01.json`);
writeFileSync(sourceCandPng, encodePngRgba(sheetW, sheetH, sheetRgba));
const times = selected.map((d) => Number(d.timeSec.toFixed(2)));
writeFileSync(sourceCandJson, `${JSON.stringify({
  source: opts.video,
  sourceSize: [decoded[0].width, decoded[0].height],
  times,
  frameSize: [cropW, cropH],
  crop: [cropX, cropY, cropW, cropH],
  keyColor: '#ff00ff',
  animation: opts.anim,
  fps: opts.fps,
}, null, 2)}\n`);

// 3. Normalize in the official Sprite Animation Workbench via Playwright
let browser;
try {
  browser = await chromium.launch({ channel: 'msedge' });
} catch {
  browser = await chromium.launch({ channel: 'chrome' });
}

const page = await browser.newPage({ viewport: { width: 1440, height: 920 } });
const workbenchState = {
  v: 1,
  mode: 'grid',
  viewMode: 'normalized',
  protectingKeyColor: false,
  zoom: 3,
  previewZoom: 2,
  rects: [],
  protectedRects: [],
  offsets: Array.from({ length: selected.length }, () => ({ x: 0, y: 0 })),
  frameScales: Array.from({ length: selected.length }, () => 100),
  anims: {
    [opts.anim]: {
      frames: Array.from({ length: selected.length }, (_, i) => i),
      fps: opts.fps,
    },
  },
  inputs: {
    fw: String(cropW),
    fh: String(cropH),
    margin: '0',
    spacing: '0',
    rw: '32',
    rh: '48',
    texel: '4',
    maxColors: '64',
    detectPadding: '8',
    keyColor: '#ff00ff',
    keyTolerance: '64',
    protectSize: '24',
    targetW: '160',
    targetH: '110',
    resampleMode: 'coverage',
    paletteSource: 'all',
    sharedTrimTop: '0',
    sharedTrimRight: '0',
    sharedTrimBottom: '0',
    sharedTrimLeft: '0',
  },
  keyEnabled: true,
  harmonizeFrameColors: false,
  lockProtectedPixels: true,
  trimTransparent: false,
  playing: true,
  onion: false,
};

const params = new URLSearchParams({
  image: `/docs/art/knight-v2-${opts.anim}-video-source-candidate-01.png`,
  state: JSON.stringify(workbenchState),
});
await page.goto(`${opts.serverUrl.replace(/\/$/, '')}/tools/sheet-slicer.html?${params.toString()}`, {
  waitUntil: 'networkidle',
});
await page.waitForFunction((expectedCount) => {
  const norm = window.__sheetSlicer && window.__sheetSlicer.normalized();
  return norm && norm.frameCount === expectedCount && norm.frameW === 160 && norm.frameH === 110;
}, selected.length);

for (const id of ['#approveSource', '#approveIdentity', '#approveMotion', '#approveAlignment']) {
  await page.check(id);
}
await page.click('#btnExportSprite');

const { normDataUrl, spriteJson, reviewDataUrl } = await page.evaluate(async (frameTimes) => {
  const norm = window.__sheetSlicer.normalized();
  const exportedJson = document.querySelector('#io').value;
  const img = new Image();
  const reviewUrl = await new Promise((res) => {
    img.onload = () => {
      const cellW = 640, cellH = 440, labelH = 24, cols = 2;
      const rows = Math.ceil(frameTimes.length / cols);
      const out = document.createElement('canvas');
      out.width = cols * cellW;
      out.height = rows * (cellH + labelH);
      const ctx = out.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, out.width, out.height);
      for (let i = 0; i < frameTimes.length; i++) {
        const col = i % cols, row = Math.floor(i / cols);
        const ox = col * cellW, oy = row * (cellH + labelH);
        for (let y = 0; y < cellH; y += 16) {
          for (let x = 0; x < cellW; x += 16) {
            ctx.fillStyle = ((x / 16 + y / 16) % 2 === 0) ? '#efefef' : '#d6d6d6';
            ctx.fillRect(ox + x, oy + y, 16, 16);
          }
        }
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(img, i * 160, 0, 160, 110, ox, oy, cellW, cellH);
        ctx.fillStyle = '#0e131f';
        ctx.fillRect(ox, oy + cellH, cellW, labelH);
        ctx.fillStyle = '#e5eef7';
        ctx.font = '14px monospace';
        ctx.textBaseline = 'middle';
        ctx.fillText(`frame ${i + 1} · ${frameTimes[i].toFixed(2)}s`, ox + 10, oy + cellH + labelH / 2);
      }
      res(out.toDataURL('image/png'));
    };
    img.src = norm.dataUrl;
  });
  return { normDataUrl: norm.dataUrl, spriteJson: exportedJson, reviewDataUrl: reviewUrl };
}, times);

await browser.close();

const normCandPng = resolve('docs/art', `knight-v2-${opts.anim}-video-normalized-candidate-01.png`);
const normReviewPng = resolve('docs/art', `knight-v2-${opts.anim}-video-normalized-review-01.png`);
const exportedSpritePath = resolve(tempDir, `${opts.anim}-export.json`);

writeFileSync(normCandPng, Buffer.from(normDataUrl.replace(/^data:image\/png;base64,/, ''), 'base64'));
writeFileSync(normReviewPng, Buffer.from(reviewDataUrl.replace(/^data:image\/png;base64,/, ''), 'base64'));
writeFileSync(exportedSpritePath, `${spriteJson}\n`);

if (opts.outDir) {
  mkdirSync(resolve(opts.outDir), { recursive: true });
  for (const p of [contactPath, sourceCandPng, normCandPng, normReviewPng]) {
    copyFileSync(p, resolve(opts.outDir, p.split(/[\\/]/).at(-1)));
  }
}

// 4. Merge into knight-v2.json and refresh shared Sprite Editor bridge
let mergeResult = null;
if (opts.merge) {
  const mergeStdout = execFileSync(process.execPath, [
    resolve('tools/merge-sprite-animation.mjs'),
    resolve(opts.target),
    exportedSpritePath,
    opts.anim,
    opts.refAnim,
  ], { encoding: 'utf8' });
  mergeResult = JSON.parse(mergeStdout);
  try {
    execFileSync(process.execPath, [
      resolve('tools/sprite-agent.mjs'),
      'open',
      opts.target.split(/[\\/]/).at(-1),
    ], { stdio: 'ignore' });
  } catch {
    // Bridge refresh is best-effort if dev server isn't listening
  }
}

const elapsedSec = ((Date.now() - t0) / 1000).toFixed(2);
console.log(JSON.stringify({
  animation: opts.anim,
  elapsedSec: Number(elapsedSec),
  decodedFrames: decoded.length,
  uniqueHashes,
  selectedIndices,
  times,
  crop: [cropX, cropY, cropW, cropH],
  artifacts: {
    contactSheet: contactPath,
    sourceCandidate: sourceCandPng,
    normalizedCandidate: normCandPng,
    normalizedReview: normReviewPng,
  },
  merge: mergeResult,
}, null, 2));
