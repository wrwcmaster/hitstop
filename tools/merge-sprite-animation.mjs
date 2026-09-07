import fs from 'node:fs';
import path from 'node:path';

const PALETTE_CHARS =
  '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz#@$%&*+=!?~^;:,<>[]{}()_-|`';

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

const [targetArg, sourceArg, animName = 'run'] = process.argv.slice(2);
if (!targetArg || !sourceArg) {
  throw new Error('usage: node tools/merge-sprite-animation.mjs <target.json> <source.json> [animation]');
}

const targetPath = path.resolve(targetArg);
const sourcePath = path.resolve(sourceArg);
const target = JSON.parse(fs.readFileSync(targetPath, 'utf8'));
const source = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
const sourceAnim = source.anims?.[animName];
const sourceSize = dimensions(sourceAnim, `source ${animName}`);

const preservedUsage = new Map();
for (const [name, anim] of Object.entries(target.anims ?? {})) {
  if (name === animName) continue;
  for (const [ch, count] of usageOf(anim)) {
    preservedUsage.set(ch, (preservedUsage.get(ch) ?? 0) + count);
  }
}

const outputPalette = {};
for (const ch of PALETTE_CHARS) {
  if (!preservedUsage.has(ch)) continue;
  if (!target.palette?.[ch]) throw new Error(`preserved palette key ${ch} is missing`);
  outputPalette[ch] = target.palette[ch].toLowerCase();
}

const preservedColors = Object.entries(outputPalette).map(([ch, color]) => ({ ch, color }));
const sourceUsage = usageOf(sourceAnim);
const sourceEntries = [...sourceUsage].map(([sourceChar, count]) => ({
  sourceChar,
  count,
  color: source.palette?.[sourceChar]?.toLowerCase(),
}));
for (const entry of sourceEntries) rgb(entry.color);

// Exact matches cost no new key. For the rare case where the two animations
// together exceed the one-character key space, discard the source swatches
// whose weighted nearest-neighbour error is smallest. This keeps frequently
// used silhouette and material colors stable while collapsing tiny highlights.
const exactMap = new Map();
let remaining = sourceEntries.filter((entry) => {
  const exact = preservedColors.find((candidate) => candidate.color === entry.color);
  if (exact) exactMap.set(entry.sourceChar, exact.ch);
  return !exact;
});
const availableSlots = PALETTE_CHARS.length - Object.keys(outputPalette).length;
const removed = [];
while (remaining.length > availableSlots) {
  let bestIndex = -1;
  let bestScore = Number.POSITIVE_INFINITY;
  for (let i = 0; i < remaining.length; i++) {
    const alternatives = [
      ...preservedColors,
      ...remaining.filter((_, index) => index !== i),
    ];
    const match = nearest(remaining[i].color, alternatives);
    const score = remaining[i].count * match.distance;
    if (score < bestScore) {
      bestIndex = i;
      bestScore = score;
    }
  }
  removed.push(remaining.splice(bestIndex, 1)[0]);
}

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

const outputColors = Object.entries(outputPalette).map(([ch, color]) => ({ ch, color }));
for (const entry of removed) {
  sourceMap.set(entry.sourceChar, nearest(entry.color, outputColors).ch);
}

const remappedFrames = sourceAnim.frames.map((frame) => frame.map((row) =>
  [...row].map((ch) => ch === '.' ? ch : sourceMap.get(ch) ?? (() => {
    throw new Error(`source frame references unmapped palette key ${ch}`);
  })()).join(''),
));

target.palette = outputPalette;
target.anims[animName] = { ...sourceAnim, frames: remappedFrames };
dimensions(target.anims[animName], `merged ${animName}`);

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
  mergedColors: removed.map((entry) => ({
    source: entry.color,
    pixels: entry.count,
    mappedTo: outputPalette[sourceMap.get(entry.sourceChar)],
  })),
  outputColors: Object.keys(outputPalette).length,
  adjustedAnchorTracks,
}, null, 2));
