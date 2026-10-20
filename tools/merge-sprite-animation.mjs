import fs from 'node:fs';
import path from 'node:path';

const PALETTE_CHARS =
  '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz#@$%&*+=!?~^;:,<>[]{}()_-|`'
  + Array.from({ length: 1024 }, (_, index) => String.fromCharCode(0x0100 + index)).join('');

function usageOf(anim) {
  const usage = new Map();
  if (!anim || typeof anim === 'string') return usage;
  for (const frame of anim.frames) {
    for (const row of frame) {
      for (const ch of row) {
        if (ch !== '.') usage.set(ch, (usage.get(ch) ?? 0) + 1);
      }
    }
  }
  return usage;
}

function rgb(hex) {
  const match = /^#([0-9a-f]{6})$/i.exec(hex ?? '');
  if (!match) throw new Error(`invalid palette color: ${hex}`);
  const value = Number.parseInt(match[1], 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function distance(a, b) {
  const ar = rgb(a);
  const br = rgb(b);
  return (ar[0] - br[0]) ** 2 + (ar[1] - br[1]) ** 2 + (ar[2] - br[2]) ** 2;
}

function nearest(color, candidates) {
  let best = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const candidate of candidates) {
    const d = distance(color, candidate.color);
    if (d < bestDistance) {
      best = candidate;
      bestDistance = d;
    }
  }
  if (!best) throw new Error('cannot map a color without a palette candidate');
  return { ...best, distance: bestDistance };
}

function dimensions(anim, label) {
  if (!anim || typeof anim === 'string' || !anim.frames.length) {
    throw new Error(`${label} must contain authored frames`);
  }
  const height = anim.frames[0].length;
  const width = anim.frames[0][0]?.length ?? 0;
  for (const [fi, frame] of anim.frames.entries()) {
    if (frame.length !== height || frame.some((row) => row.length !== width)) {
      throw new Error(`${label} frame ${fi} is not ${width}x${height}`);
    }
  }
  return { width, height };
}

function animationFrames(file, name) {
  const entry = file.anims?.[name];
  if (!entry || typeof entry === 'string') return null;
  if (Array.isArray(entry.frames)) return entry.frames;
  const layer = file.layers?.find((candidate) => candidate.tracks?.[name]);
  return layer?.tracks?.[name] ?? null;
}

function sizeOfFrames(frames, label) {
  return dimensions({ frames }, label);
}

function padFrames(frames, sourceSize, targetSize) {
  if (sourceSize.width > targetSize.width || sourceSize.height > targetSize.height) {
    throw new Error(`source ${sourceSize.width}x${sourceSize.height} exceeds target ${targetSize.width}x${targetSize.height}`);
  }
  const left = Math.floor((targetSize.width - sourceSize.width) / 2);
  const top = targetSize.height - sourceSize.height;
  return frames.map((frame) => Array.from({ length: targetSize.height }, (_, y) => {
    if (y < top || y >= top + sourceSize.height) return '.'.repeat(targetSize.width);
    return '.'.repeat(left) + frame[y - top] + '.'.repeat(targetSize.width - left - sourceSize.width);
  }));
}

const [targetArg, sourceArg, animName = 'run', referenceAnim = 'run'] = process.argv.slice(2);
if (!targetArg || !sourceArg) {
  throw new Error('usage: node tools/merge-sprite-animation.mjs <target.json> <source.json> [animation]');
}

const targetPath = path.resolve(targetArg);
const sourcePath = path.resolve(sourceArg);
const target = JSON.parse(fs.readFileSync(targetPath, 'utf8'));
const source = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
const sourceAnim = source.anims?.[animName];
const sourceSize = dimensions(sourceAnim, `source ${animName}`);

const outputPalette = Object.fromEntries(Object.entries(target.palette ?? {}).map(([ch, color]) => [
  ch,
  typeof color === 'string' ? color.toLowerCase() : color,
]));

const preservedColors = Object.entries(outputPalette).map(([ch, color]) => ({ ch, color }));
const sourceUsage = usageOf(sourceAnim);
const sourceEntries = [...sourceUsage].map(([sourceChar, count]) => ({
  sourceChar,
  count,
  color: source.palette?.[sourceChar]?.toLowerCase(),
}));
for (const entry of sourceEntries) rgb(entry.color);

// Exact matches cost no new key. New colors always receive a fresh key: an
// authored animation import must never silently quantize its material ramp.
const exactMap = new Map();
const remaining = sourceEntries.filter((entry) => {
  const exact = preservedColors.find((candidate) => candidate.color === entry.color);
  if (exact) exactMap.set(entry.sourceChar, exact.ch);
  return !exact;
});

const sourceMap = new Map(exactMap);
for (const entry of remaining) {
  const preferred = entry.sourceChar;
  const ch = PALETTE_CHARS.includes(preferred) && !(preferred in outputPalette)
    ? preferred
    : [...PALETTE_CHARS].find((candidate) => !(candidate in outputPalette));
  if (!ch) throw new Error('palette key allocation failed');
  outputPalette[ch] = entry.color;
  sourceMap.set(entry.sourceChar, ch);
}

let remappedFrames = sourceAnim.frames.map((frame) => frame.map((row) =>
  [...row].map((ch) => ch === '.' ? ch : sourceMap.get(ch) ?? (() => {
    throw new Error(`source frame references unmapped palette key ${ch}`);
  })()).join(''),
));

target.palette = outputPalette;
if (Array.isArray(target.layers)) {
  const referenceFrames = animationFrames(target, referenceAnim)
    ?? animationFrames(target, Object.keys(target.anims ?? {}).find((name) => animationFrames(target, name)));
  if (!referenceFrames) throw new Error('layered target has no authored reference frames');
  const targetSize = sizeOfFrames(referenceFrames, `target ${referenceAnim}`);
  remappedFrames = padFrames(remappedFrames, sourceSize, targetSize);
  target.anims[animName] = {
    fps: sourceAnim.fps,
    frameCount: remappedFrames.length,
    ...(sourceAnim.loop === undefined ? {} : { loop: sourceAnim.loop }),
  };
  const blank = Array.from({ length: targetSize.height }, () => '.'.repeat(targetSize.width));
  target.layers.forEach((layer, index) => {
    (layer.tracks ??= {})[animName] = index === 0
      ? remappedFrames
      : remappedFrames.map(() => [...blank]);
  });
  for (const tracks of Object.values(target.anchors ?? {})) {
    if (Array.isArray(tracks?.[animName])) continue;
    const points = tracks?.[referenceAnim];
    if (!Array.isArray(points) || !points.length) continue;
    tracks[animName] = Array.from({ length: remappedFrames.length }, (_, index) => ({
      ...points[index % points.length],
    }));
  }
  if (target.animationHitboxOffsets?.[referenceAnim] && !target.animationHitboxOffsets?.[animName]) {
    (target.animationHitboxOffsets ??= {})[animName] = { ...target.animationHitboxOffsets[referenceAnim] };
  }
} else {
  target.anims[animName] = { ...sourceAnim, frames: remappedFrames };
}
sizeOfFrames(remappedFrames, `merged ${animName}`);

// Keep attachment tracks structurally valid when an approved replacement has
// a different frame count. Existing points retain their authored order; a
// shorter track holds its final point rather than inventing motion.
let adjustedAnchorTracks = 0;
for (const tracks of Object.values(target.anchors ?? {})) {
  const points = tracks?.[animName];
  if (!Array.isArray(points) || !points.length || points.length === remappedFrames.length) continue;
  tracks[animName] = Array.from({ length: remappedFrames.length }, (_, index) => ({
    ...points[Math.min(index, points.length - 1)],
  }));
  adjustedAnchorTracks += 1;
}
fs.writeFileSync(targetPath, `${JSON.stringify(target, null, 2)}\n`);

console.log(JSON.stringify({
  animation: animName,
  frames: remappedFrames.length,
  frameSize: sourceSize,
  preservedColors: preservedColors.length,
  sourceColors: sourceEntries.length,
  exactMatches: exactMap.size,
  mergedColors: [],
  outputColors: Object.keys(outputPalette).length,
  adjustedAnchorTracks,
}, null, 2));
