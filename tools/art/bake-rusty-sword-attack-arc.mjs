import fs from 'node:fs/promises';

const ROOT = new URL('../../', import.meta.url);
const SOURCE = new URL('docs/art/knight-v2-sword-combo-video-normalized-candidate-01.json', ROOT);
const BRIDGE = 'http://127.0.0.1:5174/__sprite-editor';
const TARGET_PATH = 'equipment/rusty-sword.json';
const TARGET_LAYER = 'attack-arc';

// These are the eight colors that form the generated blue motion smear.
// Neutral blade colors are intentionally excluded so the authored sword
// remains the only blade rendered in the final composite.
const COLOR_MAP = {
  '5': ['A', '#5c74be70'],
  S: ['B', '#696ea980'],
  O: ['C', '#6c90ca96'],
  g: ['E', '#5a85c16b'],
  F: ['F', '#73b6d9a6'],
  '1': ['I', '#7dc8e1c7'],
  h: ['J', '#92a2cfd9'],
  e: ['K', '#aed4e1ee'],
  X: ['N', '#b5e2eef5'],
  '3': ['P', '#e7f5f7'],
};

// Hilt pivots in the normalized source and grip anchors in the current
// 128x128 rusty-sword sheet, both expressed in texel pixels.
const SOURCE_PIVOTS = [[103, 58], [50, 53], [44, 56], [98, 67], [114, 55], [109, 57]];
const TEXEL = 4;
const MIN_SHEET_WIDTH = 160;

function keepArc(frame, x, y, sourceKey) {
  if (!COLOR_MAP[sourceKey]) return false;
  // Frame four's generated crescent has a separate pale core. These colors
  // are also used by the blade, so select only the low horizontal band; the
  // authored sword layer is rendered above it and keeps its own clean edge.
  if (frame === 3 && (sourceKey === 'X' || sourceKey === '3')) {
    return x >= 60 && x <= 116 && y >= 73 && y <= 88;
  }
  if (frame === 1) return y >= 51 && x <= 106;
  if (frame === 2) return x <= 61 && y <= 51;
  if (frame === 3) return x <= 96 && y >= 38;
  if (frame === 4) return x >= 60 && y >= 57;
  if (frame === 5) return x >= 127 && y <= 58;
  return false;
}

function emptyFrame(w, h) {
  return Array.from({ length: h }, () => '.'.repeat(w));
}

function concreteAnimation(entry) {
  return typeof entry === 'object' && Array.isArray(entry.frames);
}

function toLayered(file) {
  if (Array.isArray(file.layers)) return file;
  const tracks = {};
  const anims = {};
  for (const [name, entry] of Object.entries(file.anims)) {
    if (typeof entry === 'string') anims[name] = entry;
    else {
      tracks[name] = entry.frames;
      anims[name] = {
        fps: entry.fps,
        frameCount: entry.frames.length,
        ...(entry.loop === undefined ? {} : { loop: entry.loop }),
      };
    }
  }
  const { anims: _anims, renderTag = 'front-hand-held-object', ...rest } = file;
  return {
    ...rest,
    anims,
    layers: [{ id: 'base', name: 'Sword', tag: renderTag, tracks }],
  };
}

function buildArcFrames(sourceFrames, targetGrips, w, h) {
  return sourceFrames.map((source, frame) => {
    const rows = emptyFrame(w, h).map((row) => row.split(''));
    const [sourceX, sourceY] = SOURCE_PIVOTS[frame];
    const [targetX, targetY] = targetGrips[frame];
    for (let y = 0; y < source.length; y += 1) {
      for (let x = 0; x < source[y].length; x += 1) {
        const sourceKey = source[y][x];
        if (!keepArc(frame, x, y, sourceKey)) continue;
        const px = x - sourceX + targetX;
        const py = y - sourceY + targetY;
        if (px < 0 || py < 0 || px >= w || py >= h) continue;
        rows[py][px] = COLOR_MAP[sourceKey][0];
      }
    }
    return rows.map((row) => row.join(''));
  });
}

/**
 * Attack frame four sweeps farther behind the wielder than the original
 * 128px weapon canvas allowed. Add transparent space on the left, shifting
 * every authored pixel and anchor together so the attached sword does not
 * move in the game while the full crescent remains inside its sheet.
 */
function ensureAttackArcRoom(file) {
  const firstLayer = file.layers[0];
  const firstTrack = Object.values(firstLayer.tracks).find((frames) => frames.length);
  const currentWidth = firstTrack?.[0]?.[0]?.length ?? 0;
  const leftPad = Math.max(0, MIN_SHEET_WIDTH - currentWidth);
  if (!leftPad) return;
  const dots = '.'.repeat(leftPad);
  for (const layer of file.layers) {
    for (const frames of Object.values(layer.tracks)) {
      for (let frame = 0; frame < frames.length; frame++) {
        frames[frame] = frames[frame].map((row) => dots + row);
      }
    }
  }
  for (const animations of Object.values(file.anchors ?? {})) {
    for (const points of Object.values(animations)) {
      for (const point of points) point.x += leftPad / TEXEL;
    }
  }
}

const source = JSON.parse(await fs.readFile(SOURCE, 'utf8'));
const stateResponse = await fetch(`${BRIDGE}/state`);
if (!stateResponse.ok) throw new Error(`sprite editor bridge returned ${stateResponse.status}`);
const state = await stateResponse.json();
if (state.path !== TARGET_PATH) {
  throw new Error(`open ${TARGET_PATH} in the sprite editor before baking (currently ${state.path ?? 'none'})`);
}

const file = toLayered(structuredClone(state.file));
ensureAttackArcRoom(file);
const base = file.layers.find((layer) => layer.id === 'base') ?? file.layers[0];
const firstFrame = Object.values(base.tracks).flat()[0];
const h = firstFrame.length;
const w = firstFrame[0].length;
for (const [, [targetKey, color]] of Object.entries(COLOR_MAP)) file.palette[targetKey] = color;

const tracks = {};
for (const [name, entry] of Object.entries(file.anims)) {
  if (typeof entry === 'string') continue;
  tracks[name] = Array.from({ length: entry.frameCount }, () => emptyFrame(w, h));
}
const targetGrips = file.anchors.grip.attack.map((point) => [point.x * TEXEL, point.y * TEXEL]);
tracks.attack = buildArcFrames(source.anims.attack.frames, targetGrips, w, h);

const arcLayer = {
  id: TARGET_LAYER,
  name: 'Slash Arc',
  tag: base.tag,
  tracks,
};
const existing = file.layers.findIndex((layer) => layer.id === TARGET_LAYER);
if (existing >= 0) file.layers.splice(existing, 1);
// The motion smear belongs behind the physical blade. This also lets the
// pale core overlap naturally without washing out the sword's authored edge.
const baseIndex = file.layers.findIndex((layer) => layer.id === base.id);
file.layers.splice(Math.max(0, baseIndex), 0, arcLayer);

const updateResponse = await fetch(`${BRIDGE}/state`, {
  method: 'PUT',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    path: TARGET_PATH,
    file,
    baseRevision: state.revision,
    source: 'agent-attack-arc',
  }),
});
const updated = await updateResponse.json();
if (!updateResponse.ok) throw new Error(updated.error ?? `state update returned ${updateResponse.status}`);

const saveResponse = await fetch(`${BRIDGE}/save`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    path: TARGET_PATH,
    baseRevision: updated.revision,
    source: 'agent-attack-arc',
  }),
});
const saved = await saveResponse.json();
if (!saveResponse.ok) throw new Error(saved.error ?? `save returned ${saveResponse.status}`);
console.log(`saved ${TARGET_PATH} revision ${saved.revision} with ${tracks.attack.length} arc frames`);
