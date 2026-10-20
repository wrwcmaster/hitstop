import {
  isLayeredSpriteFile,
  resolveSpriteHitbox,
  type FlatSpriteFile,
  type LayeredSpriteFile,
  type SpriteAnchor,
  type SpriteFile,
} from '../../src/engine/gfx/spritefile';
import { validateSpriteEditorDocument } from './sprite-editor-document';

/**
 * Automated Self-Check Critic for `SpriteFile` documents.
 *
 * Whereas `validateSpriteEditorDocument` checks structural/schema invariants
 * (matching row widths, valid palette keys, no alias cycles), `critiqueSpriteFile`
 * measures visual, biomechanical, and game-integration invariants so an agent can
 * autonomously detect and fix:
 *   1. Canvas border clipping (`border-clip`)
 *   2. Ground-plane / hitbox baseline floating or sinking (`baseline-drift`)
 *   3. Frame-to-frame volume/proportion drift (`mass-jitter`)
 *   4. Frozen duplicate frames or barely perceptible pose deltas (`duplicate-frame`, `low-motion-delta`)
 *   5. Detached 1–2px raymarch/slicer speckle (`orphan-speckle`)
 *   6. Attachment socket/anchor drift (`anchor-out-of-reach`)
 *   7. Palette bloat & near-duplicate colors (`palette-bloat`, `palette-near-duplicate`)
 *   8. Actor runtime contract mismatches (`missing-expected-anim`, `hitbox-mismatch`)
 */

export type CriticSeverity = 'error' | 'warn';

export type CriticIssueCode =
  | 'schema-invalid'
  | 'empty-frame'
  | 'border-clip'
  | 'baseline-drift'
  | 'duplicate-frame'
  | 'low-motion-delta'
  | 'mass-jitter'
  | 'orphan-speckle'
  | 'disconnected-part'
  | 'interior-pinhole'
  | 'anchor-out-of-reach'
  | 'palette-bloat'
  | 'palette-near-duplicate'
  | 'missing-expected-anim'
  | 'hitbox-mismatch';

export interface SpriteCriticIssue {
  code: CriticIssueCode;
  severity: CriticSeverity;
  animation?: string;
  frame?: number;
  message: string;
  suggestion: string;
}

export interface FrameCriticMetrics {
  frame: number;
  pixelCount: number;
  bounds: { x: number; y: number; w: number; h: number } | null;
  centroid: { x: number; y: number } | null;
  borderTouch: { top: number; bottom: number; left: number; right: number };
  diffFromPrev: number | null;
  diffRatioFromPrev: number | null;
  componentCount: number;
  orphanSpeckleCount: number;
  interiorHoleCount: number;
  baselineDelta: number | null;
}

export interface AnimCriticMetrics {
  animation: string;
  frameCount: number;
  fps: number;
  loop: boolean;
  minPixels: number;
  maxPixels: number;
  massVariationRatio: number;
  frames: FrameCriticMetrics[];
}

export interface SpriteCriticOptions {
  /** Animations that are grounded (feet should align with `hitbox.y + hitbox.h`). */
  groundedAnims?: string[];
  /** Canvas borders that are intentionally allowed to touch (e.g. `['left']` for a wall-hugging creature). */
  allowBorderTouch?: Array<'top' | 'bottom' | 'left' | 'right'>;
  /** Maximum allowed connected components per frame (default: 1 — entire body must be a single connected silhouette). */
  maxComponents?: number;
  /** Maximum allowed palette colors before flagging `palette-bloat` (default: 32). */
  maxPaletteColors?: number;
  /** Minimum RGB Euclidean distance between distinct palette colors (default: 6). */
  minColorDistance?: number;
  /** Minimum fraction of pixels that should change between adjacent frames of an active animation (default: 0.02). */
  minMotionRatio?: number;
  /** Maximum allowed relative pixel-count swing across an animation's frames (default: 0.32). */
  maxMassVariationRatio?: number;
  /** Expected animation names required by the game actor (`Monster` / `Player`). */
  expectedAnims?: string[];
  /** Expected physics hitbox dimensions `{ w, h }` from the game actor definition. */
  expectedHitboxSize?: { w: number; h: number };
}

export interface SpriteCriticReport {
  passed: boolean;
  score: number;
  errorCount: number;
  warnCount: number;
  dimensions: { w: number; h: number; gridW: number; gridH: number; hd: boolean };
  paletteCount: number;
  nearDuplicateColors: Array<{ charA: string; hexA: string; charB: string; hexB: string; distance: number }>;
  animations: Record<string, AnimCriticMetrics>;
  issues: SpriteCriticIssue[];
}

const DEFAULT_GROUNDED_ANIMS = new Set([
  'idle',
  'run',
  'walk',
  'listen',
  'toll',
  'fixate',
  'keen',
]);

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function parseHexRgb(hex: string): [number, number, number] | null {
  const clean = hex.replace(/^#/, '');
  if (clean.length < 6) return null;
  const r = Number.parseInt(clean.slice(0, 2), 16);
  const g = Number.parseInt(clean.slice(2, 4), 16);
  const b = Number.parseInt(clean.slice(4, 6), 16);
  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return null;
  return [r, g, b];
}

function compositeAnimFrames(file: SpriteFile, animName: string): string[][] {
  if (isLayeredSpriteFile(file)) {
    const layered = file as LayeredSpriteFile;
    const spec = layered.anims[animName];
    if (!spec || typeof spec === 'string') return [];
    const frames: string[][] = [];
    for (let f = 0; f < spec.frameCount; f++) {
      const firstTrack = layered.layers[0]?.tracks[animName]?.[f];
      const h = firstTrack?.length ?? layered.h ?? 1;
      const w = firstTrack?.[0]?.length ?? layered.w ?? 1;
      const grid: string[][] = Array.from({ length: h }, () => Array.from({ length: w }, () => '.'));
      for (const layer of layered.layers) {
        if ((layer as { visible?: boolean }).visible === false) continue;
        const rows = layer.tracks[animName]?.[f];
        if (!rows) continue;
        for (let y = 0; y < rows.length; y++) {
          const row = rows[y];
          for (let x = 0; x < row.length; x++) {
            const ch = row[x];
            if (ch !== '.' && ch !== ' ') {
              grid[y][x] = ch;
            }
          }
        }
      }
      frames.push(grid.map((r) => r.join('')));
    }
    return frames;
  }
  const flat = file as FlatSpriteFile;
  const spec = flat.anims[animName];
  if (!spec || typeof spec === 'string') return [];
  return spec.frames;
}

interface ComponentInfo {
  size: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

function analyzeComponents(rows: string[], gridW: number, gridH: number): ComponentInfo[] {
  const visited = new Uint8Array(gridW * gridH);
  const components: ComponentInfo[] = [];
  const queue: number[] = [];

  for (let y = 0; y < gridH; y++) {
    const row = rows[y] ?? '';
    for (let x = 0; x < gridW; x++) {
      const idx = y * gridW + x;
      if (visited[idx]) continue;
      const ch = row[x] ?? '.';
      if (ch === '.' || ch === ' ') continue;

      visited[idx] = 1;
      queue.length = 0;
      queue.push(idx);
      let head = 0;
      let size = 0;
      let minX = x, maxX = x, minY = y, maxY = y;

      while (head < queue.length) {
        const cur = queue[head++];
        const cy = Math.floor(cur / gridW);
        const cx = cur % gridW;
        size++;
        if (cx < minX) minX = cx;
        if (cx > maxX) maxX = cx;
        if (cy < minY) minY = cy;
        if (cy > maxY) maxY = cy;

        const ortho: Array<[number, number]> = [
          [-1, 0],
          [1, 0],
          [0, -1],
          [0, 1],
        ];
        for (const [dx, dy] of ortho) {
          const nx = cx + dx, ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= gridW || ny >= gridH) continue;
          const nIdx = ny * gridW + nx;
          if (visited[nIdx]) continue;
          const nCh = rows[ny]?.[nx] ?? '.';
          if (nCh === '.' || nCh === ' ') continue;
          visited[nIdx] = 1;
          queue.push(nIdx);
        }
      }

      components.push({ size, minX, minY, maxX, maxY });
    }
  }

  components.sort((a, b) => b.size - a.size);
  return components;
}

function boxGap(a: ComponentInfo, b: ComponentInfo): number {
  const dx = Math.max(0, a.minX - b.maxX - 1, b.minX - a.maxX - 1);
  const dy = Math.max(0, a.minY - b.maxY - 1, b.minY - a.maxY - 1);
  return Math.max(dx, dy);
}

/**
 * Detect small interior fill islands (non-outline pixels) that got pinched off
 * from the main body and are only held together by outer outline pixels.
 */
function analyzeFillPinchOffs(
  rows: string[],
  gridW: number,
  gridH: number,
  outlineChar: string,
): ComponentInfo[] {
  const visited = new Uint8Array(gridW * gridH);
  const comps: Array<ComponentInfo & { pixels: Array<[number, number]> }> = [];
  const queue: number[] = [];

  for (let y = 0; y < gridH; y++) {
    const row = rows[y] ?? '';
    for (let x = 0; x < gridW; x++) {
      const idx = y * gridW + x;
      if (visited[idx]) continue;
      const ch = row[x] ?? '.';
      if (ch === '.' || ch === ' ' || ch === outlineChar) continue;

      visited[idx] = 1;
      queue.length = 0;
      queue.push(idx);
      let head = 0;
      let size = 0;
      let minX = x, maxX = x, minY = y, maxY = y;
      const pixels: Array<[number, number]> = [];

      while (head < queue.length) {
        const cur = queue[head++];
        const cy = Math.floor(cur / gridW);
        const cx = cur % gridW;
        size++;
        pixels.push([cx, cy]);
        if (cx < minX) minX = cx;
        if (cx > maxX) maxX = cx;
        if (cy < minY) minY = cy;
        if (cy > maxY) maxY = cy;

        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            const nx = cx + dx, ny = cy + dy;
            if (nx < 0 || ny < 0 || nx >= gridW || ny >= gridH) continue;
            const nIdx = ny * gridW + nx;
            if (visited[nIdx]) continue;
            const nCh = rows[ny]?.[nx] ?? '.';
            if (nCh === '.' || nCh === ' ' || nCh === outlineChar) continue;
            visited[nIdx] = 1;
            queue.push(nIdx);
          }
        }
      }
      comps.push({ size, minX, minY, maxX, maxY, pixels });
    }
  }

  comps.sort((a, b) => b.size - a.size);
  if (comps.length <= 1) return [];

  const pinched: ComponentInfo[] = [];
  for (let i = 1; i < comps.length; i++) {
    const c = comps[i];
    pinched.push({ size: c.size, minX: c.minX, minY: c.minY, maxX: c.maxX, maxY: c.maxY });
  }
  return pinched;
}

/**
 * Flood-fill transparent background (`'.'` or `' '`) from the 4 canvas borders.
 * Any unvisited transparent cell is an enclosed interior hole/void inside the sprite silhouette.
 */
function analyzeInteriorPinholes(rows: string[], gridW: number, gridH: number): ComponentInfo[] {
  const visited = new Uint8Array(gridW * gridH);
  const queue: number[] = [];

  const isTransparent = (x: number, y: number): boolean => {
    const ch = rows[y]?.[x] ?? '.';
    return ch === '.' || ch === ' ';
  };

  for (let x = 0; x < gridW; x++) {
    if (isTransparent(x, 0) && !visited[x]) {
      visited[x] = 1;
      queue.push(x);
    }
    const botIdx = (gridH - 1) * gridW + x;
    if (isTransparent(x, gridH - 1) && !visited[botIdx]) {
      visited[botIdx] = 1;
      queue.push(botIdx);
    }
  }
  for (let y = 0; y < gridH; y++) {
    const leftIdx = y * gridW;
    if (isTransparent(0, y) && !visited[leftIdx]) {
      visited[leftIdx] = 1;
      queue.push(leftIdx);
    }
    const rightIdx = y * gridW + (gridW - 1);
    if (isTransparent(gridW - 1, y) && !visited[rightIdx]) {
      visited[rightIdx] = 1;
      queue.push(rightIdx);
    }
  }

  let head = 0;
  const ortho: Array<[number, number]> = [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
  ];
  while (head < queue.length) {
    const cur = queue[head++];
    const cy = Math.floor(cur / gridW);
    const cx = cur % gridW;
    for (const [dx, dy] of ortho) {
      const nx = cx + dx, ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= gridW || ny >= gridH) continue;
      const nIdx = ny * gridW + nx;
      if (visited[nIdx] || !isTransparent(nx, ny)) continue;
      visited[nIdx] = 1;
      queue.push(nIdx);
    }
  }

  const holes: ComponentInfo[] = [];
  for (let y = 0; y < gridH; y++) {
    for (let x = 0; x < gridW; x++) {
      const idx = y * gridW + x;
      if (visited[idx] || !isTransparent(x, y)) continue;
      visited[idx] = 1;
      queue.length = 0;
      queue.push(idx);
      let hHead = 0;
      let size = 0;
      let minX = x, maxX = x, minY = y, maxY = y;
      while (hHead < queue.length) {
        const cur = queue[hHead++];
        const cy = Math.floor(cur / gridW);
        const cx = cur % gridW;
        size++;
        if (cx < minX) minX = cx;
        if (cx > maxX) maxX = cx;
        if (cy < minY) minY = cy;
        if (cy > maxY) maxY = cy;
        for (const [dx, dy] of ortho) {
          const nx = cx + dx, ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= gridW || ny >= gridH) continue;
          const nIdx = ny * gridW + nx;
          if (visited[nIdx] || !isTransparent(nx, ny)) continue;
          visited[nIdx] = 1;
          queue.push(nIdx);
        }
      }
      holes.push({ size, minX, minY, maxX, maxY });
    }
  }
  return holes;
}

/**
 * Run a comprehensive quality, consistency, and contract self-check on `file`.
 */
export function critiqueSpriteFile(
  file: SpriteFile,
  opts: SpriteCriticOptions = {},
): SpriteCriticReport {
  const issues: SpriteCriticIssue[] = [];

  try {
    validateSpriteEditorDocument(file);
  } catch (err) {
    issues.push({
      code: 'schema-invalid',
      severity: 'error',
      message: err instanceof Error ? err.message : String(err),
      suggestion: 'Fix structural SpriteFile errors before running visual checks.',
    });
    return {
      passed: false,
      score: 0,
      errorCount: 1,
      warnCount: 0,
      dimensions: { w: file.w ?? 0, h: file.h ?? 0, gridW: 0, gridH: 0, hd: file.hd !== false },
      paletteCount: 0,
      nearDuplicateColors: [],
      animations: {},
      issues,
    };
  }

  const hd = file.hd !== false;
  const density = hd ? 1 : 4;

  // Determine grid dimensions from first authored frame
  let gridW = Math.round((file.w ?? 16) * density);
  let gridH = Math.round((file.h ?? 16) * density);
  for (const animName of Object.keys(file.anims)) {
    const frames = compositeAnimFrames(file, animName);
    if (frames.length > 0 && frames[0].length > 0) {
      gridH = frames[0].length;
      gridW = frames[0][0].length;
      break;
    }
  }
  const logicalW = file.w ?? gridW / density;
  const logicalH = file.h ?? gridH / density;
  const defaultHitbox = {
    x: file.hitbox?.x ?? 0,
    y: file.hitbox?.y ?? 0,
    w: file.hitbox?.w ?? logicalW,
    h: file.hitbox?.h ?? logicalH,
  };

  // 1. Check expected actor contract (animations & hitbox)
  if (opts.expectedAnims) {
    for (const reqAnim of opts.expectedAnims) {
      if (!(reqAnim in file.anims)) {
        issues.push({
          code: 'missing-expected-anim',
          severity: 'error',
          animation: reqAnim,
          message: `Missing required animation "${reqAnim}" expected by game actor.`,
          suggestion: `Add "${reqAnim}" (or an alias) to rig.anims.`,
        });
      }
    }
  }

  if (opts.expectedHitboxSize) {
    if (defaultHitbox.w !== opts.expectedHitboxSize.w || defaultHitbox.h !== opts.expectedHitboxSize.h) {
      issues.push({
        code: 'hitbox-mismatch',
        severity: 'error',
        message: `Sprite hitbox (${defaultHitbox.w}x${defaultHitbox.h}) does not match actor physics size (${opts.expectedHitboxSize.w}x${opts.expectedHitboxSize.h}).`,
        suggestion: `Set rig.hitbox.w=${opts.expectedHitboxSize.w} and rig.hitbox.h=${opts.expectedHitboxSize.h}.`,
      });
    }
  }

  // 2. Palette discipline check
  const paletteEntries = Object.entries(file.palette ?? {}).filter(
    ([ch, val]) => ch !== '.' && val !== null && typeof val === 'string',
  ) as Array<[string, string]>;
  const paletteCount = paletteEntries.length;
  const maxPaletteColors = opts.maxPaletteColors ?? 32;
  const minColorDistance = opts.minColorDistance ?? 6;

  if (paletteCount > maxPaletteColors) {
    issues.push({
      code: 'palette-bloat',
      severity: 'warn',
      message: `Palette has ${paletteCount} colors (recommended <= ${maxPaletteColors}).`,
      suggestion: 'Consolidate material ramps or quantize near-duplicate shades.',
    });
  }

  const nearDuplicateColors: SpriteCriticReport['nearDuplicateColors'] = [];
  for (let i = 0; i < paletteEntries.length; i++) {
    const [charA, hexA] = paletteEntries[i];
    const rgbA = parseHexRgb(hexA);
    if (!rgbA) continue;
    for (let j = i + 1; j < paletteEntries.length; j++) {
      const [charB, hexB] = paletteEntries[j];
      const rgbB = parseHexRgb(hexB);
      if (!rgbB) continue;
      const dist = Math.hypot(rgbA[0] - rgbB[0], rgbA[1] - rgbB[1], rgbA[2] - rgbB[2]);
      if (dist < minColorDistance) {
        nearDuplicateColors.push({ charA, hexA, charB, hexB, distance: round2(dist) });
      }
    }
  }
  if (nearDuplicateColors.length > 0) {
    const sample = nearDuplicateColors[0];
    issues.push({
      code: 'palette-near-duplicate',
      severity: 'warn',
      message: `${nearDuplicateColors.length} near-duplicate color pair(s) found (e.g. "${sample.charA}" ${sample.hexA} vs "${sample.charB}" ${sample.hexB}, RGB dist=${sample.distance}).`,
      suggestion: 'Share the same hex code across materials when stops are visually indistinguishable.',
    });
  }

  // 3. Per-animation & per-frame biomechanical checks
  const allowedBorders = new Set(opts.allowBorderTouch ?? []);
  const groundedSet = opts.groundedAnims ? new Set(opts.groundedAnims) : DEFAULT_GROUNDED_ANIMS;
  const minMotionRatio = opts.minMotionRatio ?? 0.02;
  const maxMassVariationRatio = opts.maxMassVariationRatio ?? 0.32;

  const animations: Record<string, AnimCriticMetrics> = {};

  for (const [animName, spec] of Object.entries(file.anims)) {
    if (typeof spec === 'string') continue; // alias
    const frames = compositeAnimFrames(file, animName);
    const frameMetrics: FrameCriticMetrics[] = [];
    const animHitbox = resolveSpriteHitbox(file, animName, defaultHitbox);
    const isGroundedAnim = groundedSet.has(animName);

    let minPixels = Infinity;
    let maxPixels = 0;

    for (let f = 0; f < frames.length; f++) {
      const rows = frames[f];
      let pixelCount = 0;
      let sumX = 0;
      let sumY = 0;
      let minX = gridW, maxX = -1, minY = gridH, maxY = -1;
      let topTouch = 0, bottomTouch = 0, leftTouch = 0, rightTouch = 0;

      for (let y = 0; y < gridH; y++) {
        const row = rows[y] ?? '';
        for (let x = 0; x < gridW; x++) {
          const ch = row[x] ?? '.';
          if (ch === '.' || ch === ' ') continue;
          pixelCount++;
          sumX += x + 0.5;
          sumY += y + 0.5;
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
          if (y === 0) topTouch++;
          if (y === gridH - 1) bottomTouch++;
          if (x === 0) leftTouch++;
          if (x === gridW - 1) rightTouch++;
        }
      }

      if (pixelCount === 0) {
        issues.push({
          code: 'empty-frame',
          severity: 'error',
          animation: animName,
          frame: f,
          message: `Frame ${animName}#${f} has 0 opaque pixels.`,
          suggestion: 'Check bone visibility, camera origin, or shape radii for this frame.',
        });
      }

      minPixels = Math.min(minPixels, pixelCount);
      maxPixels = Math.max(maxPixels, pixelCount);

      // Border clipping check
      const touches: Array<['top' | 'bottom' | 'left' | 'right', number]> = [
        ['top', topTouch],
        ['bottom', bottomTouch],
        ['left', leftTouch],
        ['right', rightTouch],
      ];
      for (const [edge, count] of touches) {
        if (count > 0 && !allowedBorders.has(edge)) {
          issues.push({
            code: 'border-clip',
            severity: count >= 4 ? 'error' : 'warn',
            animation: animName,
            frame: f,
            message: `Frame ${animName}#${f} touches the ${edge} canvas border (${count}px on edge) — silhouette may be clipped.`,
            suggestion: edge === 'top'
              ? 'Increase rig.h / rig.origin.y or reduce upward translation/height in this pose.'
              : edge === 'bottom'
                ? 'Move rig.origin.y up by 1–2px or increase rig.h so feet have a 1px bottom margin.'
                : `Increase rig.w (and adjust rig.origin.x / hitbox.x) or tuck ${edge}-reaching limbs.`,
          });
        }
      }

      // Diff from previous frame
      let diffFromPrev: number | null = null;
      let diffRatioFromPrev: number | null = null;
      if (f > 0) {
        const prevRows = frames[f - 1];
        let diff = 0;
        for (let y = 0; y < gridH; y++) {
          const rA = prevRows[y] ?? '';
          const rB = rows[y] ?? '';
          for (let x = 0; x < gridW; x++) {
            if ((rA[x] ?? '.') !== (rB[x] ?? '.')) diff++;
          }
        }
        diffFromPrev = diff;
        diffRatioFromPrev = pixelCount > 0 ? round2(diff / pixelCount) : 0;

        if (diff === 0) {
          issues.push({
            code: 'duplicate-frame',
            severity: 'warn',
            animation: animName,
            frame: f,
            message: `Frame ${animName}#${f} is identical to ${animName}#${f - 1} (0 pixels changed).`,
            suggestion: 'Increase pose rotation/translation amplitude so every frame produces a distinct pixel silhouette.',
          });
        } else if (diffRatioFromPrev < minMotionRatio) {
          issues.push({
            code: 'low-motion-delta',
            severity: 'warn',
            animation: animName,
            frame: f,
            message: `Frame ${animName}#${f} changes only ${diff}px (${Math.round(diffRatioFromPrev * 100)}%) from ${animName}#${f - 1}.`,
            suggestion: 'Amplify bone pose deltas between frames so the motion reads clearly at pixel resolution.',
          });
        }
      }

      // Connected components & detached part / orphan speckle check
      const maxComponents = opts.maxComponents ?? 1;
      const components = analyzeComponents(rows, gridW, gridH);
      const outlineChar = paletteEntries[0]?.[0] ?? '0';
      const pinched = analyzeFillPinchOffs(rows, gridW, gridH, outlineChar);
      let orphanSpeckleCount = pinched.filter((c) => c.size <= 2).length;
      if (components.length > 1) {
        const mainComp = components[0];
        for (let c = 1; c < components.length; c++) {
          const comp = components[c];
          if (comp.size <= 2 && boxGap(mainComp, comp) >= 1) {
            orphanSpeckleCount++;
          }
        }
      }
      if (components.length > maxComponents || pinched.length > 0) {
        const detachedList = [
          ...components.slice(maxComponents).map((c) => `silhouette:${c.size}px@(${c.minX},${c.minY})`),
          ...pinched.map((c) => `fill-pinch:${c.size}px@(${c.minX},${c.minY})`),
        ].join(', ');
        issues.push({
          code: orphanSpeckleCount > 0 ? 'orphan-speckle' : 'disconnected-part',
          severity: 'warn',
          animation: animName,
          frame: f,
          message: `Frame ${animName}#${f} has detached/pinched geometry (${detachedList}).`,
          suggestion: 'Anchor limb/knot root deeper inside the parent bone volume or thicken radius (+0.3) so it stays connected across all rotation angles.',
        });
      }

      // Enclosed interior transparent hole / pinhole check (including interior outline-color leaks)
      const interiorHoles = analyzeInteriorPinholes(rows, gridW, gridH);
      let interiorOutlineCount = 0;
      let firstInteriorOutline: [number, number] | null = null;
      for (let y = 1; y < gridH - 1; y++) {
        for (let x = 1; x < gridW - 1; x++) {
          if ((rows[y]?.[x] ?? '.') !== outlineChar) continue;
          let touchesOuterEmpty = false;
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              const nCh = rows[y + dy]?.[x + dx] ?? '.';
              if (nCh === '.' || nCh === ' ') {
                touchesOuterEmpty = true;
                break;
              }
            }
            if (touchesOuterEmpty) break;
          }
          if (!touchesOuterEmpty) {
            interiorOutlineCount++;
            if (!firstInteriorOutline) firstInteriorOutline = [x, y];
          }
        }
      }
      if (interiorHoles.length > 0 || interiorOutlineCount > 0) {
        const holeList = [
          ...interiorHoles.map((h) => `void:${h.size}px@(${h.minX},${h.minY})`),
          ...(interiorOutlineCount > 0
            ? [`outline-leak:${interiorOutlineCount}px@(${firstInteriorOutline![0]},${firstInteriorOutline![1]})`]
            : []),
        ].join(', ');
        issues.push({
          code: 'interior-pinhole',
          severity: 'error',
          animation: animName,
          frame: f,
          message: `Frame ${animName}#${f} has interior hole/leak artifact(s) inside the silhouette (${holeList}).`,
          suggestion: 'Increase limb/torso overlap and use material shadow stops (not outlineColor) for internal depth creases.',
        });
      }

      // Baseline alignment check on grounded animations
      const bounds = pixelCount > 0
        ? {
            x: round2(minX / density),
            y: round2(minY / density),
            w: round2((maxX - minX + 1) / density),
            h: round2((maxY - minY + 1) / density),
          }
        : null;
      const baselineDelta = bounds
        ? round2((maxY + 1) / density - (animHitbox.y + animHitbox.h))
        : null;

      if (isGroundedAnim && baselineDelta !== null && Math.abs(baselineDelta) > 1.5) {
        issues.push({
          code: 'baseline-drift',
          severity: 'warn',
          animation: animName,
          frame: f,
          message: `Grounded frame ${animName}#${f} bottom (${bounds!.y + bounds!.h}px) drifts ${baselineDelta > 0 ? '+' : ''}${baselineDelta}px from hitbox floor (${animHitbox.y + animHitbox.h}px).`,
          suggestion: 'Align rig.origin.y and hitbox.y + hitbox.h with the lowest grounded foot/base pixel.',
        });
      }

      // Anchor reachability check
      if (file.anchors && bounds) {
        for (const [anchorName, animMap] of Object.entries(file.anchors)) {
          const pt: SpriteAnchor | undefined = animMap?.[animName]?.[f];
          if (!pt) continue;
          const dx = Math.max(0, bounds.x - pt.x, pt.x - (bounds.x + bounds.w));
          const dy = Math.max(0, bounds.y - pt.y, pt.y - (bounds.y + bounds.h));
          const distOutside = Math.hypot(dx, dy);
          if (distOutside > 6) {
            issues.push({
              code: 'anchor-out-of-reach',
              severity: 'warn',
              animation: animName,
              frame: f,
              message: `Anchor "${anchorName}" at (${pt.x}, ${pt.y}) in ${animName}#${f} is ${round2(distOutside)}px outside the sprite bounds.`,
              suggestion: `Check socket "${anchorName}" local offset on its parent bone.`,
            });
          }
        }
      }

      frameMetrics.push({
        frame: f,
        pixelCount,
        bounds,
        centroid: pixelCount > 0
          ? { x: round2(sumX / pixelCount / density), y: round2(sumY / pixelCount / density) }
          : null,
        borderTouch: { top: topTouch, bottom: bottomTouch, left: leftTouch, right: rightTouch },
        diffFromPrev,
        diffRatioFromPrev,
        componentCount: components.length,
        orphanSpeckleCount,
        interiorHoleCount: interiorHoles.length,
        baselineDelta,
      });
    }

    const massVariationRatio = maxPixels > 0 && minPixels < Infinity
      ? round2((maxPixels - minPixels) / maxPixels)
      : 0;

    if (frames.length > 1 && massVariationRatio > maxMassVariationRatio) {
      issues.push({
        code: 'mass-jitter',
        severity: 'warn',
        animation: animName,
        message: `Animation "${animName}" opaque pixel volume varies by ${Math.round(massVariationRatio * 100)}% (${minPixels}px..${maxPixels}px, threshold ${Math.round(maxMassVariationRatio * 100)}%).`,
        suggestion: 'Keep 3D bone scale changes conservative so character mass stays consistent across the cycle.',
      });
    }

    const loop = (spec as { loop?: boolean }).loop !== false;
    animations[animName] = {
      animation: animName,
      frameCount: frames.length,
      fps: spec.fps,
      loop,
      minPixels: minPixels === Infinity ? 0 : minPixels,
      maxPixels,
      massVariationRatio,
      frames: frameMetrics,
    };
  }

  const errorCount = issues.filter((i) => i.severity === 'error').length;
  const warnCount = issues.filter((i) => i.severity === 'warn').length;
  const score = Math.max(0, 100 - errorCount * 25 - warnCount * 8);

  return {
    passed: errorCount === 0 && warnCount === 0,
    score,
    errorCount,
    warnCount,
    dimensions: { w: logicalW, h: logicalH, gridW, gridH, hd },
    paletteCount,
    nearDuplicateColors,
    animations,
    issues,
  };
}

/* ---------------- Closed-Loop Reference Parity Critic ---------------- */

export type MaterialFamily = 'empty' | 'outline' | 'skin' | 'eye' | 'leather_hair' | 'cloth_dark';

export interface RegionParityMetrics {
  region: 'face' | 'cloth' | 'hands' | 'legs';
  refPixels: number;
  candPixels: number;
  silhouetteIoU: number;
  materialMatchRatio: number;
  refShadeTransitions: number;
  candShadeTransitions: number;
  detailParityRatio: number;
}

export interface FrameParityMetrics {
  frame: number;
  refPixels: number;
  candPixels: number;
  silhouetteIoU: number;
  tolerantIoU: number;
  materialMatchRatio: number;
  centroidDelta: { dx: number; dh: number };
  boundsDelta: { dMinX: number; dMaxX: number; dMinH: number; dMaxH: number };
  regions: Record<'face' | 'cloth' | 'hands' | 'legs', RegionParityMetrics>;
}

export interface AnimParityMetrics {
  animation: string;
  frameCount: number;
  meanSilhouetteIoU: number;
  meanTolerantIoU: number;
  meanMaterialMatch: number;
  meanFaceParity: number;
  meanClothParity: number;
  meanHandParity: number;
  meanLegParity: number;
  frames: FrameParityMetrics[];
}

export interface ReferenceParityReport {
  overallSilhouetteIoU: number;
  overallTolerantIoU: number;
  overallMaterialMatch: number;
  overallDetailParity: number;
  animations: Record<string, AnimParityMetrics>;
}

function classifyHexFamily(hex: string | undefined | null): MaterialFamily {
  if (!hex) return 'empty';
  const rgb = parseHexRgb(hex);
  if (!rgb) return 'empty';
  const [r, g, b] = rgb;
  const luma = 0.299 * r + 0.587 * g + 0.114 * b;
  if (luma < 36) return 'outline';
  // Eye sclera (very bright neutral) or emerald/teal iris (g > r + 8)
  if ((r > 215 && g > 225 && b > 225) || (g > r + 8 && g > 75)) return 'eye';
  // Warm skin vs brown leather/hair vs cool slate/dark cloth
  const warmth = r - b;
  if (warmth >= 45 && r >= 130 && g >= 78 && b >= 58) return 'skin';
  if (warmth >= 28 && r >= 55) return 'leather_hair';
  return 'cloth_dark';
}

/**
 * Ground-aligned sub-pixel reference parity evaluator.
 * Aligns `candidate` and `reference` by their ground-plane hitbox origin
 * `(hitbox.x + hitbox.w / 2, hitbox.y + hitbox.h)` and measures per-frame
 * Silhouette IoU, 1-subpixel Tolerant IoU, Material-Family accuracy, and
 * Regional Detail Parity across `face`, `cloth`, `hands`, and `legs`.
 */
export function compareSpriteToReference(
  candidate: SpriteFile,
  reference: SpriteFile,
  animsToCompare: string[] = ['idle', 'run'],
): ReferenceParityReport {
  const candDensity = candidate.hd !== false ? 1 : 4;
  const refDensity = reference.hd !== false ? 1 : 4;
  const candHb = {
    x: candidate.hitbox?.x ?? 0,
    y: candidate.hitbox?.y ?? 0,
    w: candidate.hitbox?.w ?? candidate.w ?? 16,
    h: candidate.hitbox?.h ?? candidate.h ?? 16,
  };
  const refHb = {
    x: reference.hitbox?.x ?? 0,
    y: reference.hitbox?.y ?? 0,
    w: reference.hitbox?.w ?? reference.w ?? 16,
    h: reference.hitbox?.h ?? reference.h ?? 16,
  };

  const candOx = Math.round((candHb.x + candHb.w / 2) * candDensity);
  const candOy = Math.round((candHb.y + candHb.h) * candDensity);
  const refOx = Math.round((refHb.x + refHb.w / 2) * refDensity);
  const refOy = Math.round((refHb.y + refHb.h) * refDensity);

  const candPal = candidate.palette ?? {};
  const refPal = reference.palette ?? {};

  // Evaluate over a unified ground-relative sub-pixel window:
  // dxSub in [-60..+60], hSub in [-16..+112]
  const minDx = -60, maxDx = 60;
  const minH = -16, maxH = 112;
  const winW = maxDx - minDx + 1;
  const winH = maxH - minH + 1;

  const animReports: Record<string, AnimParityMetrics> = {};
  let totalIoU = 0, totalTolIoU = 0, totalMat = 0, totalDetail = 0, totalFrames = 0;

  for (const animName of animsToCompare) {
    const candFrames = compositeAnimFrames(candidate, animName);
    const refFrames = compositeAnimFrames(reference, animName);
    const count = Math.min(candFrames.length, refFrames.length);
    if (count === 0) continue;

    const frameReports: FrameParityMetrics[] = [];
    for (let f = 0; f < count; f++) {
      const cRows = candFrames[f];
      const rRows = refFrames[f];

      const cCharGrid = new Array<string>(winW * winH).fill('.');
      const rCharGrid = new Array<string>(winW * winH).fill('.');
      const cFamGrid = new Array<MaterialFamily>(winW * winH).fill('empty');
      const rFamGrid = new Array<MaterialFamily>(winW * winH).fill('empty');

      let cCount = 0, rCount = 0;
      let cSumX = 0, cSumH = 0, rSumX = 0, rSumH = 0;
      let cMinX = 1e6, cMaxX = -1e6, cMinH = 1e6, cMaxH = -1e6;
      let rMinX = 1e6, rMaxX = -1e6, rMinH = 1e6, rMaxH = -1e6;

      for (let hSub = minH; hSub <= maxH; hSub++) {
        const wy = hSub - minH;
        const cy = candOy - hSub;
        const ry = refOy - hSub;
        const cRow = cy >= 0 && cy < cRows.length ? cRows[cy] : '';
        const rRow = ry >= 0 && ry < rRows.length ? rRows[ry] : '';
        for (let dxSub = minDx; dxSub <= maxDx; dxSub++) {
          const wx = dxSub - minDx;
          const idx = wy * winW + wx;
          const cx = candOx + dxSub;
          const rx = refOx + dxSub;
          const cCh = cx >= 0 && cx < cRow.length ? cRow[cx] : '.';
          const rCh = rx >= 0 && rx < rRow.length ? rRow[rx] : '.';
          if (cCh !== '.' && cCh !== ' ') {
            cCharGrid[idx] = cCh;
            cFamGrid[idx] = classifyHexFamily(candPal[cCh]);
            cCount++;
            cSumX += dxSub;
            cSumH += hSub;
            if (dxSub < cMinX) cMinX = dxSub;
            if (dxSub > cMaxX) cMaxX = dxSub;
            if (hSub < cMinH) cMinH = hSub;
            if (hSub > cMaxH) cMaxH = hSub;
          }
          if (rCh !== '.' && rCh !== ' ') {
            rCharGrid[idx] = rCh;
            rFamGrid[idx] = classifyHexFamily(refPal[rCh]);
            rCount++;
            rSumX += dxSub;
            rSumH += hSub;
            if (dxSub < rMinX) rMinX = dxSub;
            if (dxSub > rMaxX) rMaxX = dxSub;
            if (hSub < rMinH) rMinH = hSub;
            if (hSub > rMaxH) rMaxH = hSub;
          }
        }
      }

      let inter = 0, union = 0, tolInter = 0, matMatch = 0;
      const hasNeighbor = (grid: MaterialFamily[], wx: number, wy: number): boolean => {
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = wx + dx, ny = wy + dy;
            if (nx >= 0 && ny >= 0 && nx < winW && ny < winH && grid[ny * winW + nx] !== 'empty') {
              return true;
            }
          }
        }
        return false;
      };

      for (let wy = 0; wy < winH; wy++) {
        for (let wx = 0; wx < winW; wx++) {
          const idx = wy * winW + wx;
          const cOn = cFamGrid[idx] !== 'empty';
          const rOn = rFamGrid[idx] !== 'empty';
          if (cOn || rOn) {
            union++;
            if (cOn && rOn) {
              inter++;
              tolInter++;
              if (
                cFamGrid[idx] === rFamGrid[idx] ||
                cFamGrid[idx] === 'outline' ||
                rFamGrid[idx] === 'outline'
              ) {
                matMatch++;
              }
            } else if (cOn && hasNeighbor(rFamGrid, wx, wy)) {
              tolInter++;
            } else if (rOn && hasNeighbor(cFamGrid, wx, wy)) {
              tolInter++;
            }
          }
        }
      }

      // Evaluate regional parity (in sub-pixel units: 4 sub-pixels = 1 logical pixel)
      const evalRegion = (
        region: 'face' | 'cloth' | 'hands' | 'legs',
        x0: number,
        x1: number,
        h0: number,
        h1: number,
      ): RegionParityMetrics => {
        let rPx = 0, cPx = 0, regInter = 0, regUnion = 0, regMat = 0;
        let rTrans = 0, cTrans = 0;
        for (let hSub = h0; hSub <= h1; hSub++) {
          const wy = hSub - minH;
          if (wy < 0 || wy >= winH) continue;
          for (let dxSub = x0; dxSub <= x1; dxSub++) {
            const wx = dxSub - minDx;
            if (wx < 0 || wx >= winW) continue;
            const idx = wy * winW + wx;
            const cF = cFamGrid[idx];
            const rF = rFamGrid[idx];
            if (cF !== 'empty') cPx++;
            if (rF !== 'empty') rPx++;
            if (cF !== 'empty' || rF !== 'empty') {
              regUnion++;
              if (cF !== 'empty' && rF !== 'empty') {
                regInter++;
                if (cF === rF || cF === 'outline' || rF === 'outline') regMat++;
              }
            }
            // Count interior shade transitions (non-outline neighbor color change)
            if (wx + 1 < winW) {
              const cNext = cCharGrid[idx + 1];
              if (
                cF !== 'empty' && cF !== 'outline' &&
                cFamGrid[idx + 1] !== 'empty' && cFamGrid[idx + 1] !== 'outline' &&
                cCharGrid[idx] !== cNext
              ) {
                cTrans++;
              }
              const rNext = rCharGrid[idx + 1];
              if (
                rF !== 'empty' && rF !== 'outline' &&
                rFamGrid[idx + 1] !== 'empty' && rFamGrid[idx + 1] !== 'outline' &&
                rCharGrid[idx] !== rNext
              ) {
                rTrans++;
              }
            }
          }
        }
        const silIoU = regUnion > 0 ? round2(regInter / regUnion) : 1;
        const matRatio = regInter > 0 ? round2(regMat / regInter) : 0;
        const transRatio = rTrans > 0 ? round2(Math.min(cTrans, rTrans) / Math.max(cTrans, rTrans)) : 1;
        const detailParity = round2(silIoU * 0.45 + matRatio * 0.3 + transRatio * 0.25);
        return {
          region,
          refPixels: rPx,
          candPixels: cPx,
          silhouetteIoU: silIoU,
          materialMatchRatio: matRatio,
          refShadeTransitions: rTrans,
          candShadeTransitions: cTrans,
          detailParityRatio: detailParity,
        };
      };

      const regions = {
        face: evalRegion('face', -10, 16, 70, 96),
        cloth: evalRegion('cloth', -28, 16, 36, 74),
        hands: evalRegion('hands', -24, 28, 36, 62),
        legs: evalRegion('legs', -32, 32, -4, 40),
      };

      const silIoU = union > 0 ? round2(inter / union) : 0;
      const tolIoU = union > 0 ? round2(tolInter / union) : 0;
      const matRatio = inter > 0 ? round2(matMatch / inter) : 0;

      frameReports.push({
        frame: f,
        refPixels: rCount,
        candPixels: cCount,
        silhouetteIoU: silIoU,
        tolerantIoU: tolIoU,
        materialMatchRatio: matRatio,
        centroidDelta: {
          dx: round2(((cCount > 0 ? cSumX / cCount : 0) - (rCount > 0 ? rSumX / rCount : 0)) / 4),
          dh: round2(((cCount > 0 ? cSumH / cCount : 0) - (rCount > 0 ? rSumH / rCount : 0)) / 4),
        },
        boundsDelta: {
          dMinX: round2((cMinX - rMinX) / 4),
          dMaxX: round2((cMaxX - rMaxX) / 4),
          dMinH: round2((cMinH - rMinH) / 4),
          dMaxH: round2((cMaxH - rMaxH) / 4),
        },
        regions,
      });

      totalIoU += silIoU;
      totalTolIoU += tolIoU;
      totalMat += matRatio;
      totalDetail +=
        (regions.face.detailParityRatio +
          regions.cloth.detailParityRatio +
          regions.hands.detailParityRatio +
          regions.legs.detailParityRatio) /
        4;
      totalFrames++;
    }

    const avg = (fn: (m: FrameParityMetrics) => number) =>
      round2(frameReports.reduce((acc, m) => acc + fn(m), 0) / frameReports.length);

    animReports[animName] = {
      animation: animName,
      frameCount: count,
      meanSilhouetteIoU: avg((m) => m.silhouetteIoU),
      meanTolerantIoU: avg((m) => m.tolerantIoU),
      meanMaterialMatch: avg((m) => m.materialMatchRatio),
      meanFaceParity: avg((m) => m.regions.face.detailParityRatio),
      meanClothParity: avg((m) => m.regions.cloth.detailParityRatio),
      meanHandParity: avg((m) => m.regions.hands.detailParityRatio),
      meanLegParity: avg((m) => m.regions.legs.detailParityRatio),
      frames: frameReports,
    };
  }

  return {
    overallSilhouetteIoU: totalFrames > 0 ? round2(totalIoU / totalFrames) : 0,
    overallTolerantIoU: totalFrames > 0 ? round2(totalTolIoU / totalFrames) : 0,
    overallMaterialMatch: totalFrames > 0 ? round2(totalMat / totalFrames) : 0,
    overallDetailParity: totalFrames > 0 ? round2(totalDetail / totalFrames) : 0,
    animations: animReports,
  };
}
