import {
  compositeSpriteFrame,
  isLayeredSpriteFile,
  resolveAnimName,
  resolveAnimTiming,
  type SpriteAnchor,
  type SpriteFile,
  type SpriteLayerData,
} from '../../src/engine/gfx/spritefile';
import type { Palette } from '../../src/engine/gfx/sprite';
import { PAL } from '../../src/game/content/palette';
import {
  insertSpriteFrame,
  materializeSpriteAnimationAlias,
  moveSpriteFrame,
  removeSpriteFrame,
  spriteDocumentFrameSize,
  validateSpriteEditorDocument,
  type InsertFrameMode,
} from './sprite-editor-document';

/**
 * Stable, DOM-free command model for human and agent sprite editing.
 *
 * Every command names its animation, zero-based frame, and layer. Commands
 * execute against a clone and the complete document is validated only after
 * the batch succeeds, so a failed assertion or malformed transform cannot
 * leave half an edit in the live browser document.
 */

export interface SpriteAgentCursor {
  animation: string;
  frame: number;
  layerId?: string;
}

export interface SpriteAgentFrameRef extends SpriteAgentCursor {
  /** Omit to read the active document. Sources may name another sprite. */
  path?: string;
}

export interface SpriteAgentRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type SpriteAgentRegion =
  | { rect: SpriteAgentRect }
  | { componentAt: { x: number; y: number; connectivity?: 4 | 8 } }
  | { opaqueBounds: true };

export interface SpriteAgentTransform {
  /** Clockwise degrees in canvas coordinates. */
  rotate?: number;
  /** Negative values mirror. Defaults to 1. */
  scaleX?: number;
  /** Negative values mirror. Defaults to scaleX. */
  scaleY?: number;
}

export interface SpriteAgentPoint {
  x: number;
  y: number;
}

export interface SpriteAgentAxis {
  start: SpriteAgentPoint;
  end: SpriteAgentPoint;
}

export interface SpriteAgentFrameQuery extends SpriteAgentFrameRef {
  components?: boolean;
  /** Defaults to true; disable when only geometry is needed to reduce output. */
  colors?: boolean;
}

export type SpriteAgentCommand =
  | {
    op: 'layer.ensure';
    layer: { id: string; name: string; tag: string; composition?: 'base' | 'overlay' };
    /** Insert before this layer id; append when omitted. */
    before?: string;
  }
  | {
    op: 'animation.materialize';
    animation: string;
  }
  | {
    op: 'frame.insert';
    animation: string;
    index: number;
    mode?: InsertFrameMode;
  }
  | {
    op: 'frame.remove';
    animation: string;
    index: number;
  }
  | {
    op: 'frame.move';
    animation: string;
    from: number;
    to: number;
  }
  | {
    op: 'frame.clear';
    target: SpriteAgentFrameRef & { layerId?: string | '*' };
    region?: SpriteAgentRegion;
  }
  | {
    op: 'frame.copy';
    from: SpriteAgentFrameRef;
    to: SpriteAgentFrameRef & { x: number; y: number };
    region?: SpriteAgentRegion;
    transform?: SpriteAgentTransform;
    /** `over` ignores transparent source cells; `replace` clears the output rectangle first. */
    mode?: 'over' | 'replace';
    /** Fail rather than silently degrade colors by default. */
    paletteOverflow?: 'error' | 'nearest';
    /** Exact source-color -> destination-color replacements applied during copy. */
    colorMap?: Record<string, string | null>;
  }
  | {
    op: 'frame.copyAligned';
    from: SpriteAgentFrameRef;
    to: SpriteAgentFrameRef;
    region?: SpriteAgentRegion;
    /** Source-frame pixel coordinates. The extracted clip is rotated/scaled around its center. */
    sourceAxis: SpriteAgentAxis;
    /** Destination-frame pixel coordinates. Both endpoints are aligned by one uniform transform. */
    targetAxis: SpriteAgentAxis;
    /** Defaults to 0.75px, the maximum error introduced by integer-grid placement. */
    maxEndpointError?: number;
    mode?: 'over' | 'replace';
    paletteOverflow?: 'error' | 'nearest';
    colorMap?: Record<string, string | null>;
  }
  | {
    op: 'frame.remapColors';
    target: SpriteAgentFrameRef;
    colors: Record<string, string | null>;
    region?: SpriteAgentRegion;
    paletteOverflow?: 'error' | 'nearest';
  }
  | {
    op: 'pixel.set';
    target: SpriteAgentFrameRef;
    pixels: Array<{ x: number; y: number; color: string | null }>;
    paletteOverflow?: 'error' | 'nearest';
  }
  | {
    op: 'anchor.set';
    anchor: string;
    animation: string;
    frame: number;
    point: SpriteAnchor;
  }
  | {
    op: 'assert.frame';
    target: SpriteAgentFrameRef;
    expected: {
      pixelCount?: number;
      bounds?: SpriteAgentRect | null;
      componentCount?: number;
    };
  }
  | {
    op: 'assert.anchor';
    anchor: string;
    animation: string;
    frame: number;
    expected: SpriteAnchor;
  };

export interface SpriteAgentTransaction {
  /** Omit for the current version; incompatible explicit versions are rejected. */
  protocolVersion?: number;
  commands: SpriteAgentCommand[];
  /** Inspect these frames after the batch, including for dry runs. */
  inspect?: SpriteAgentFrameQuery[];
  /** Validate and report without publishing the edited document. */
  dryRun?: boolean;
}

export interface SpriteAgentComponentInspection extends SpriteAgentRect {
  pixelCount: number;
  /** One guaranteed member useful as a future componentAt seed. */
  seed: { x: number; y: number };
}

export interface SpriteAgentColorInspection {
  char: string;
  color: string;
  count: number;
}

export interface SpriteAgentFrameInspection {
  path: string | null;
  animation: string;
  concreteAnimation: string;
  frame: number;
  layerId?: string;
  size: { w: number; h: number };
  pixelCount: number;
  bounds: SpriteAgentRect | null;
  colors?: SpriteAgentColorInspection[];
  components?: SpriteAgentComponentInspection[];
  anchors: Record<string, SpriteAnchor>;
}

export interface SpriteAgentDocumentInspection {
  path: string | null;
  size: { w: number; h: number };
  animations: Array<{ name: string; concrete: string; fps: number; frameCount: number; loop: boolean }>;
  layers: Array<{ id: string; name: string; tag: string; composition: 'base' | 'overlay' }>;
  anchors: string[];
  frames: SpriteAgentFrameInspection[];
}

export interface SpriteAgentCommandResult {
  op: SpriteAgentCommand['op'];
  changed: boolean;
  detail: Record<string, unknown>;
}

export interface SpriteAgentTransactionResult {
  file: SpriteFile;
  changed: boolean;
  cursor?: SpriteAgentCursor;
  results: SpriteAgentCommandResult[];
  inspection?: SpriteAgentDocumentInspection;
}

export interface SpriteAgentWorkspace {
  activePath: string | null;
  active: SpriteFile;
  /** Repository documents referenced by frame.copy. */
  documents?: ReadonlyMap<string, SpriteFile>;
}

export const SPRITE_AGENT_PROTOCOL_VERSION = 1;
export const SPRITE_AGENT_MAX_COMMANDS = 256;
export const SPRITE_AGENT_MAX_INSPECTIONS = 128;

export const SPRITE_AGENT_OPERATIONS = [
  'layer.ensure',
  'animation.materialize',
  'frame.insert',
  'frame.remove',
  'frame.move',
  'frame.clear',
  'frame.copy',
  'frame.copyAligned',
  'frame.remapColors',
  'pixel.set',
  'anchor.set',
  'assert.frame',
  'assert.anchor',
] as const satisfies readonly SpriteAgentCommand['op'][];

const SPRITE_AGENT_OPERATION_SET = new Set<string>(SPRITE_AGENT_OPERATIONS);

const SPRITE_AGENT_COMMAND_REFERENCE = {
  'layer.ensure': {
    required: ['layer.id', 'layer.name', 'layer.tag'],
    optional: ['layer.composition', 'before'],
    effect: 'Create a shared layer track or update the named layer metadata.',
  },
  'animation.materialize': {
    required: ['animation'],
    effect: 'Turn an animation alias into an independent timeline, including layer and anchor tracks.',
  },
  'frame.insert': {
    required: ['animation', 'index'],
    optional: ['mode: empty|duplicate'],
    effect: 'Insert a frame while keeping every layer and anchor track aligned.',
  },
  'frame.remove': {
    required: ['animation', 'index'],
    effect: 'Remove a frame from every layer and anchor track.',
  },
  'frame.move': {
    required: ['animation', 'from', 'to'],
    effect: 'Reorder a frame together with all layer and anchor data.',
  },
  'frame.clear': {
    required: ['target.animation', 'target.frame'],
    optional: ['target.layerId (* means every layer)', 'region'],
    effect: 'Make the addressed pixels transparent.',
  },
  'frame.copy': {
    required: ['from.animation', 'from.frame', 'to.animation', 'to.frame', 'to.x', 'to.y'],
    optional: ['from.path', 'from.layerId', 'to.layerId', 'region', 'transform', 'mode', 'paletteOverflow', 'colorMap'],
    effect: 'Copy exact-color pixels from an active or repository document, applying scale/mirror/rotation once.',
  },
  'frame.copyAligned': {
    required: [
      'from.animation', 'from.frame', 'to.animation', 'to.frame',
      'sourceAxis.start', 'sourceAxis.end', 'targetAxis.start', 'targetAxis.end',
    ],
    optional: ['from.path', 'from.layerId', 'to.layerId', 'region', 'maxEndpointError', 'mode', 'paletteOverflow', 'colorMap'],
    effect: 'Copy pixels with uniform scale, rotation, and placement derived from two source and target control points.',
  },
  'frame.remapColors': {
    required: ['target.animation', 'target.frame', 'colors'],
    optional: ['target.layerId', 'region', 'paletteOverflow'],
    effect: 'Replace exact RGBA colors without changing the selected silhouette.',
  },
  'pixel.set': {
    required: ['target.animation', 'target.frame', 'pixels[]: {x,y,color}'],
    optional: ['target.layerId', 'paletteOverflow'],
    effect: 'Set sparse pixels by RGBA value rather than palette character.',
  },
  'anchor.set': {
    required: ['anchor', 'animation', 'frame', 'point.x', 'point.y'],
    optional: ['point.angle'],
    effect: 'Set one frame-aligned attachment point in the active document.',
  },
  'assert.frame': {
    required: ['target.animation', 'target.frame', 'expected'],
    optional: ['target.layerId', 'expected.pixelCount', 'expected.bounds', 'expected.componentCount'],
    effect: 'Abort the complete transaction unless the post-edit frame matches.',
  },
  'assert.anchor': {
    required: ['anchor', 'animation', 'frame', 'expected.x', 'expected.y'],
    optional: ['expected.angle'],
    effect: 'Abort the complete transaction unless the post-edit anchor matches.',
  },
} as const satisfies Record<SpriteAgentCommand['op'], {
  required: readonly string[];
  optional?: readonly string[];
  effect: string;
}>;

/** Machine-readable discovery data served by the development bridge. */
export const SPRITE_AGENT_CAPABILITIES = {
  protocolVersion: SPRITE_AGENT_PROTOCOL_VERSION,
  frameIndexing: 'zero-based',
  colorFormat: '#RRGGBB or #RRGGBBAA; null means transparent',
  transaction: {
    atomic: true,
    revisionChecked: true,
    maxCommands: SPRITE_AGENT_MAX_COMMANDS,
    maxInspections: SPRITE_AGENT_MAX_INSPECTIONS,
  },
  regions: ['rect', 'componentAt', 'opaqueBounds'],
  transforms: ['rotate', 'scaleX', 'scaleY', 'negative scale mirrors', 'two-point uniform alignment'],
  transformPlacement: 'scale/mirror/rotation use the extracted region center; to.x/to.y place the transformed output bounding box top-left',
  operations: SPRITE_AGENT_OPERATIONS,
  commandReference: SPRITE_AGENT_COMMAND_REFERENCE,
  inspectionOptions: {
    components: 'include connected components; defaults to false',
    colors: 'include exact palette/color usage; defaults to true',
  },
} as const;

interface PixelClip {
  rows: string[];
  mask: string[];
  palette: Palette;
  bounds: SpriteAgentRect;
}

interface ResolvedFrame {
  file: SpriteFile;
  path: string | null;
  animation: string;
  concreteAnimation: string;
  frame: number;
  layerId?: string;
  rows: string[];
}

const AUTO_PALETTE_CHARS =
  '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz#@$%&*+=!?~^;:,<>[]{}()_-|`'
  + Array.from({ length: 256 }, (_, index) => String.fromCharCode(0x0100 + index)).join('');

interface Rgba { r: number; g: number; b: number; a: number }

function integer(value: unknown, label: string, minimum = 0): number {
  if (!Number.isInteger(value) || Number(value) < minimum) {
    throw new Error(`${label} must be an integer >= ${minimum}`);
  }
  return Number(value);
}

function finite(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${label} must be finite`);
  return value;
}

function nonEmpty(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be non-empty`);
  return value;
}

function parseRgba(value: string | null | undefined): Rgba | null {
  const match = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(value ?? '');
  if (!match) return null;
  const rgb = Number.parseInt(match[1], 16);
  return {
    r: (rgb >> 16) & 255,
    g: (rgb >> 8) & 255,
    b: rgb & 255,
    a: match[2] ? Number.parseInt(match[2], 16) : 255,
  };
}

function rgbaHex(color: Rgba): string {
  const byte = (value: number): string => Math.max(0, Math.min(255, Math.round(value)))
    .toString(16).padStart(2, '0');
  const rgb = `#${byte(color.r)}${byte(color.g)}${byte(color.b)}`;
  return color.a === 255 ? rgb : `${rgb}${byte(color.a)}`;
}

function normalizeColor(value: string | null, label = 'color'): string | null {
  if (value === null) return null;
  const parsed = parseRgba(value);
  if (!parsed) throw new Error(`${label} must be #RRGGBB, #RRGGBBAA, or null`);
  return rgbaHex(parsed);
}

function colorDistance(a: Rgba, b: Rgba): number {
  return (a.r - b.r) ** 2 + (a.g - b.g) ** 2 + (a.b - b.b) ** 2 + (a.a - b.a) ** 2;
}

function resolvedPalette(file: SpriteFile): Palette {
  return { ...PAL, ...(file.palette ?? {}), '.': null };
}

function isOpaque(rows: string[], palette: Palette, x: number, y: number): boolean {
  const ch = rows[y]?.[x] ?? '.';
  return ch !== '.' && palette[ch] !== null && palette[ch] !== undefined;
}

function frameBounds(rows: string[], palette: Palette, mask?: string[]): SpriteAgentRect | null {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < rows.length; y++) for (let x = 0; x < rows[y].length; x++) {
    if (mask && mask[y]?.[x] !== '1') continue;
    if (!isOpaque(rows, palette, x, y)) continue;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return maxX < 0 ? null : { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

function frameComponents(rows: string[], palette: Palette, connectivity: 4 | 8 = 8): SpriteAgentComponentInspection[] {
  const h = rows.length;
  const w = rows[0]?.length ?? 0;
  const seen = new Uint8Array(w * h);
  const offsets = connectivity === 4
    ? [[1, 0], [-1, 0], [0, 1], [0, -1]]
    : [-1, 0, 1].flatMap((dy) => [-1, 0, 1].map((dx) => [dx, dy])).filter(([dx, dy]) => dx || dy);
  const out: SpriteAgentComponentInspection[] = [];
  for (let sy = 0; sy < h; sy++) for (let sx = 0; sx < w; sx++) {
    const start = sy * w + sx;
    if (seen[start] || !isOpaque(rows, palette, sx, sy)) continue;
    const queue: Array<[number, number]> = [[sx, sy]];
    seen[start] = 1;
    let head = 0;
    let minX = sx;
    let minY = sy;
    let maxX = sx;
    let maxY = sy;
    while (head < queue.length) {
      const [x, y] = queue[head++];
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      for (const [dx, dy] of offsets) {
        const nx = x + dx;
        const ny = y + dy;
        const index = ny * w + nx;
        if (nx < 0 || nx >= w || ny < 0 || ny >= h || seen[index] || !isOpaque(rows, palette, nx, ny)) continue;
        seen[index] = 1;
        queue.push([nx, ny]);
      }
    }
    out.push({
      x: minX,
      y: minY,
      w: maxX - minX + 1,
      h: maxY - minY + 1,
      pixelCount: queue.length,
      seed: { x: sx, y: sy },
    });
  }
  return out.sort((a, b) => b.pixelCount - a.pixelCount || a.y - b.y || a.x - b.x);
}

function componentMask(
  rows: string[],
  palette: Palette,
  seedX: number,
  seedY: number,
  connectivity: 4 | 8,
): { bounds: SpriteAgentRect; mask: string[] } {
  const w = rows[0]?.length ?? 0;
  const h = rows.length;
  integer(seedX, 'componentAt.x');
  integer(seedY, 'componentAt.y');
  if (seedX >= w || seedY >= h || !isOpaque(rows, palette, seedX, seedY)) {
    throw new Error(`componentAt ${seedX},${seedY} is not an opaque pixel`);
  }
  const cells = new Set<string>([`${seedX},${seedY}`]);
  const queue: Array<[number, number]> = [[seedX, seedY]];
  const offsets = connectivity === 4
    ? [[1, 0], [-1, 0], [0, 1], [0, -1]]
    : [-1, 0, 1].flatMap((dy) => [-1, 0, 1].map((dx) => [dx, dy])).filter(([dx, dy]) => dx || dy);
  for (let head = 0; head < queue.length; head++) {
    const [x, y] = queue[head];
    for (const [dx, dy] of offsets) {
      const nx = x + dx;
      const ny = y + dy;
      const key = `${nx},${ny}`;
      if (nx < 0 || nx >= w || ny < 0 || ny >= h || cells.has(key) || !isOpaque(rows, palette, nx, ny)) continue;
      cells.add(key);
      queue.push([nx, ny]);
    }
  }
  const xs = queue.map(([x]) => x);
  const ys = queue.map(([, y]) => y);
  const bounds = {
    x: Math.min(...xs), y: Math.min(...ys),
    w: Math.max(...xs) - Math.min(...xs) + 1,
    h: Math.max(...ys) - Math.min(...ys) + 1,
  };
  const mask = Array.from({ length: bounds.h }, (_, y) => Array.from(
    { length: bounds.w },
    (_, x) => cells.has(`${bounds.x + x},${bounds.y + y}`) ? '1' : '.',
  ).join(''));
  return { bounds, mask };
}

function validateRect(rect: SpriteAgentRect, size: { w: number; h: number }, label: string): SpriteAgentRect {
  const value = {
    x: integer(rect.x, `${label}.x`),
    y: integer(rect.y, `${label}.y`),
    w: integer(rect.w, `${label}.w`, 1),
    h: integer(rect.h, `${label}.h`, 1),
  };
  if (value.x + value.w > size.w || value.y + value.h > size.h) {
    throw new Error(`${label} ${value.x},${value.y} ${value.w}x${value.h} exceeds ${size.w}x${size.h}`);
  }
  return value;
}

function regionMask(rows: string[], palette: Palette, region?: SpriteAgentRegion): { bounds: SpriteAgentRect; mask: string[] } {
  const size = { w: rows[0]?.length ?? 0, h: rows.length };
  if (!region || 'opaqueBounds' in region) {
    const bounds = frameBounds(rows, palette);
    if (!bounds) throw new Error('source frame has no opaque pixels');
    return { bounds, mask: Array.from({ length: bounds.h }, () => '1'.repeat(bounds.w)) };
  }
  if ('componentAt' in region) {
    const connectivity = region.componentAt.connectivity ?? 8;
    if (connectivity !== 4 && connectivity !== 8) throw new Error('component connectivity must be 4 or 8');
    return componentMask(rows, palette, region.componentAt.x, region.componentAt.y, connectivity);
  }
  const bounds = validateRect(region.rect, size, 'region.rect');
  return { bounds, mask: Array.from({ length: bounds.h }, () => '1'.repeat(bounds.w)) };
}

function extractClip(frame: ResolvedFrame, region?: SpriteAgentRegion): PixelClip {
  const palette = resolvedPalette(frame.file);
  const { bounds, mask } = regionMask(frame.rows, palette, region);
  return {
    rows: Array.from({ length: bounds.h }, (_, y) => frame.rows[bounds.y + y].slice(bounds.x, bounds.x + bounds.w)),
    mask,
    palette,
    bounds,
  };
}

interface ClipTransformGeometry {
  angle: number;
  scaleX: number;
  scaleY: number;
  cos: number;
  sin: number;
  minX: number;
  minY: number;
  outW: number;
  outH: number;
  sourceW: number;
  sourceH: number;
}

function clipTransformGeometry(clip: PixelClip, transform: SpriteAgentTransform = {}): ClipTransformGeometry {
  const angle = finite(transform.rotate ?? 0, 'transform.rotate') * Math.PI / 180;
  const scaleX = finite(transform.scaleX ?? 1, 'transform.scaleX');
  const scaleY = finite(transform.scaleY ?? transform.scaleX ?? 1, 'transform.scaleY');
  if (scaleX === 0 || scaleY === 0) throw new Error('transform scale cannot be zero');
  if (Math.abs(scaleX) > 16 || Math.abs(scaleY) > 16) throw new Error('transform scale magnitude cannot exceed 16');

  const sourceW = clip.rows[0].length;
  const sourceH = clip.rows.length;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const corners = [
    [-sourceW / 2, -sourceH / 2], [sourceW / 2, -sourceH / 2],
    [sourceW / 2, sourceH / 2], [-sourceW / 2, sourceH / 2],
  ].map(([x, y]) => ({
    x: x * scaleX * cos - y * scaleY * sin,
    y: x * scaleX * sin + y * scaleY * cos,
  }));
  const minX = Math.min(...corners.map((point) => point.x));
  const maxX = Math.max(...corners.map((point) => point.x));
  const minY = Math.min(...corners.map((point) => point.y));
  const maxY = Math.max(...corners.map((point) => point.y));
  const outW = Math.max(1, Math.ceil(maxX - minX - 1e-9));
  const outH = Math.max(1, Math.ceil(maxY - minY - 1e-9));
  if (outW * outH > 1_000_000) throw new Error(`transformed copy is too large (${outW}x${outH})`);
  return { angle, scaleX, scaleY, cos, sin, minX, minY, outW, outH, sourceW, sourceH };
}

function transformClipPoint(
  clip: PixelClip,
  geometry: ClipTransformGeometry,
  point: SpriteAgentPoint,
  label: string,
): SpriteAgentPoint {
  const absoluteX = finite(point.x, `${label}.x`);
  const absoluteY = finite(point.y, `${label}.y`);
  if (
    absoluteX < clip.bounds.x || absoluteX > clip.bounds.x + clip.bounds.w
    || absoluteY < clip.bounds.y || absoluteY > clip.bounds.y + clip.bounds.h
  ) {
    throw new Error(`${label} ${absoluteX},${absoluteY} is outside extracted source bounds ${clip.bounds.x},${clip.bounds.y} ${clip.bounds.w}x${clip.bounds.h}`);
  }
  const localX = absoluteX - clip.bounds.x - geometry.sourceW / 2;
  const localY = absoluteY - clip.bounds.y - geometry.sourceH / 2;
  return {
    x: localX * geometry.scaleX * geometry.cos - localY * geometry.scaleY * geometry.sin - geometry.minX,
    y: localX * geometry.scaleX * geometry.sin + localY * geometry.scaleY * geometry.cos - geometry.minY,
  };
}

function transformClip(clip: PixelClip, transform: SpriteAgentTransform = {}): PixelClip {
  const geometry = clipTransformGeometry(clip, transform);
  const {
    cos, sin, scaleX, scaleY, minX, minY, outW, outH, sourceW, sourceH,
  } = geometry;
  const rows = Array.from({ length: outH }, () => Array(outW).fill('.'));
  const mask = Array.from({ length: outH }, () => Array(outW).fill('.'));

  // One inverse sample applies scale, mirror, and rotation together. Reusing
  // an already transformed raster would compound degradation frame by frame.
  for (let y = 0; y < outH; y++) for (let x = 0; x < outW; x++) {
    const dx = x + 0.5 + minX;
    const dy = y + 0.5 + minY;
    const unrotatedX = dx * cos + dy * sin;
    const unrotatedY = -dx * sin + dy * cos;
    const sx = Math.floor(unrotatedX / scaleX + sourceW / 2);
    const sy = Math.floor(unrotatedY / scaleY + sourceH / 2);
    if (sx < 0 || sx >= sourceW || sy < 0 || sy >= sourceH || clip.mask[sy][sx] !== '1') continue;
    rows[y][x] = clip.rows[sy][sx];
    mask[y][x] = '1';
  }
  return {
    rows: rows.map((row) => row.join('')),
    mask: mask.map((row) => row.join('')),
    palette: clip.palette,
    bounds: { x: 0, y: 0, w: outW, h: outH },
  };
}

function sourceFile(workspace: SpriteAgentWorkspace, path: string | undefined): { file: SpriteFile; path: string | null } {
  if (!path || path === workspace.activePath) return { file: workspace.active, path: workspace.activePath };
  const file = workspace.documents?.get(path);
  if (!file) throw new Error(`source sprite "${path}" was not loaded`);
  return { file, path };
}

function resolveFrame(workspace: SpriteAgentWorkspace, ref: SpriteAgentFrameRef, editable = false): ResolvedFrame {
  const source = editable ? { file: workspace.active, path: workspace.activePath } : sourceFile(workspace, ref.path);
  if (editable && ref.path && ref.path !== workspace.activePath) throw new Error('commands may only edit the active sprite');
  const animation = nonEmpty(ref.animation, 'animation');
  if (!(animation in source.file.anims)) throw new Error(`unknown animation "${animation}"`);
  const concreteAnimation = resolveAnimName(source.file, animation);
  const timing = resolveAnimTiming(source.file, animation);
  if (!timing) throw new Error(`animation "${animation}" cannot be resolved`);
  const frame = integer(ref.frame, 'frame');
  if (frame >= timing.frameCount) throw new Error(`frame ${frame} is outside "${animation}" (0-${timing.frameCount - 1})`);

  let rows: string[] | undefined;
  let layerId: string | undefined;
  if (isLayeredSpriteFile(source.file)) {
    if (ref.layerId) {
      const layer = source.file.layers.find((candidate) => candidate.id === ref.layerId);
      if (!layer) throw new Error(`unknown layer "${ref.layerId}"`);
      rows = layer.tracks[concreteAnimation]?.[frame];
      layerId = layer.id;
    } else if (editable) {
      throw new Error('layerId is required when editing a layered sprite');
    } else {
      rows = compositeSpriteFrame(source.file, animation, frame, resolvedPalette(source.file));
    }
  } else {
    if (ref.layerId && ref.layerId !== 'base') throw new Error(`flat sprite has no layer "${ref.layerId}"`);
    const entry = source.file.anims[concreteAnimation];
    rows = typeof entry === 'string' ? undefined : entry.frames[frame];
    layerId = 'base';
  }
  if (!rows) throw new Error(`missing pixels for ${animation} frame ${frame}`);
  return { ...source, animation, concreteAnimation, frame, layerId, rows };
}

function setFrameRows(frame: ResolvedFrame, rows: string[]): void {
  if (isLayeredSpriteFile(frame.file)) {
    const layer = frame.file.layers.find((candidate) => candidate.id === frame.layerId)!;
    layer.tracks[frame.concreteAnimation][frame.frame] = rows;
  } else {
    const entry = frame.file.anims[frame.concreteAnimation];
    if (!entry || typeof entry === 'string') throw new Error(`animation "${frame.animation}" has no pixels`);
    entry.frames[frame.frame] = rows;
  }
  frame.rows = rows;
}

function nearestPaletteChar(file: SpriteFile, color: string): string {
  const wanted = parseRgba(color)!;
  let nearest = '';
  let distance = Number.POSITIVE_INFINITY;
  for (const [ch, value] of Object.entries(resolvedPalette(file))) {
    const candidate = parseRgba(value);
    if (!candidate) continue;
    const next = colorDistance(wanted, candidate);
    if (next < distance) {
      nearest = ch;
      distance = next;
    }
  }
  if (!nearest) throw new Error(`sprite has no opaque palette color for ${color}`);
  return nearest;
}

function paletteChar(
  file: SpriteFile,
  colorValue: string | null,
  overflow: 'error' | 'nearest' = 'error',
): { char: string; added: boolean; approximated: boolean } {
  const color = normalizeColor(colorValue);
  if (color === null) return { char: '.', added: false, approximated: false };
  const palette = resolvedPalette(file);
  const existing = Object.entries(palette).find(([, value]) => (
    value !== null && normalizeColor(value) === color
  ))?.[0];
  if (existing) return { char: existing, added: false, approximated: false };
  const free = [...AUTO_PALETTE_CHARS].find((ch) => !(ch in palette));
  if (free) {
    (file.palette ??= {})[free] = color;
    return { char: free, added: true, approximated: false };
  }
  if (overflow === 'nearest') return { char: nearestPaletteChar(file, color), added: false, approximated: true };
  throw new Error(`palette is full; cannot preserve ${color} (set paletteOverflow to "nearest" explicitly to approximate)`);
}

function mappedSourceColor(color: string, map: Record<string, string | null> | undefined): string | null {
  if (!map) return color;
  const normalized = normalizeColor(color)!;
  for (const [from, to] of Object.entries(map)) {
    if (normalizeColor(from, 'colorMap key') === normalized) return normalizeColor(to, 'colorMap value');
  }
  return normalized;
}

function pasteClip(
  target: ResolvedFrame,
  clip: PixelClip,
  x: number,
  y: number,
  mode: 'over' | 'replace',
  overflow: 'error' | 'nearest',
  colorMap?: Record<string, string | null>,
): { changedPixels: number; addedColors: number; approximatedColors: number; bounds: SpriteAgentRect } {
  integer(x, 'to.x');
  integer(y, 'to.y');
  const w = target.rows[0].length;
  const h = target.rows.length;
  if (x + clip.bounds.w > w || y + clip.bounds.h > h) {
    throw new Error(`transformed copy at ${x},${y} ${clip.bounds.w}x${clip.bounds.h} exceeds ${w}x${h}`);
  }
  const rows = target.rows.map((row) => [...row]);
  const remap = new Map<string, string>();
  let addedColors = 0;
  let approximatedColors = 0;
  let changedPixels = 0;
  for (let cy = 0; cy < clip.bounds.h; cy++) for (let cx = 0; cx < clip.bounds.w; cx++) {
    const tx = x + cx;
    const ty = y + cy;
    if (mode === 'replace' && rows[ty][tx] !== '.') {
      rows[ty][tx] = '.';
      changedPixels++;
    }
    if (clip.mask[cy]?.[cx] !== '1') continue;
    const sourceChar = clip.rows[cy][cx];
    const sourceColor = sourceChar === '.' ? null : clip.palette[sourceChar];
    if (!sourceColor) continue;
    let mapped = remap.get(sourceChar);
    if (!mapped) {
      const allocated = paletteChar(target.file, mappedSourceColor(sourceColor, colorMap), overflow);
      mapped = allocated.char;
      remap.set(sourceChar, mapped);
      if (allocated.added) addedColors++;
      if (allocated.approximated) approximatedColors++;
    }
    if (rows[ty][tx] !== mapped) {
      rows[ty][tx] = mapped;
      changedPixels++;
    }
  }
  setFrameRows(target, rows.map((row) => row.join('')));
  return {
    changedPixels, addedColors, approximatedColors,
    bounds: { x, y, w: clip.bounds.w, h: clip.bounds.h },
  };
}

function clearRows(rows: string[], palette: Palette, region?: SpriteAgentRegion): { rows: string[]; count: number } {
  const { bounds, mask } = region
    ? regionMask(rows, palette, region)
    : { bounds: { x: 0, y: 0, w: rows[0].length, h: rows.length }, mask: rows.map((row) => '1'.repeat(row.length)) };
  const next = rows.map((row) => [...row]);
  let count = 0;
  for (let y = 0; y < bounds.h; y++) for (let x = 0; x < bounds.w; x++) {
    if (mask[y][x] !== '1') continue;
    const tx = bounds.x + x;
    const ty = bounds.y + y;
    if (next[ty][tx] !== '.') {
      next[ty][tx] = '.';
      count++;
    }
  }
  return { rows: next.map((row) => row.join('')), count };
}

function ensureLayer(file: SpriteFile, command: Extract<SpriteAgentCommand, { op: 'layer.ensure' }>): SpriteAgentCommandResult {
  if (!isLayeredSpriteFile(file)) throw new Error('layer.ensure requires a layered sprite');
  const id = nonEmpty(command.layer.id, 'layer.id');
  const existing = file.layers.find((layer) => layer.id === id);
  if (existing) {
    const changed = existing.name !== command.layer.name || existing.tag !== command.layer.tag
      || (existing.composition ?? 'base') !== (command.layer.composition ?? 'base');
    existing.name = nonEmpty(command.layer.name, 'layer.name');
    existing.tag = nonEmpty(command.layer.tag, 'layer.tag');
    existing.composition = command.layer.composition;
    return { op: command.op, changed, detail: { layerId: id, created: false } };
  }
  const size = spriteDocumentFrameSize(file);
  const tracks: SpriteLayerData['tracks'] = {};
  for (const [animation, entry] of Object.entries(file.anims)) {
    if (typeof entry === 'string') continue;
    tracks[animation] = Array.from(
      { length: entry.frameCount },
      () => Array.from({ length: size.h }, () => '.'.repeat(size.w)),
    );
  }
  const layer: SpriteLayerData = {
    id,
    name: nonEmpty(command.layer.name, 'layer.name'),
    tag: nonEmpty(command.layer.tag, 'layer.tag'),
    composition: command.layer.composition,
    tracks,
  };
  const index = command.before === undefined
    ? file.layers.length
    : file.layers.findIndex((candidate) => candidate.id === command.before);
  if (index < 0) throw new Error(`unknown before layer "${command.before}"`);
  file.layers.splice(index, 0, layer);
  return { op: command.op, changed: true, detail: { layerId: id, created: true, index } };
}

function inspectResolvedFrame(
  frame: ResolvedFrame,
  options: { components?: boolean; colors?: boolean } = {},
): SpriteAgentFrameInspection {
  const palette = resolvedPalette(frame.file);
  const colors = new Map<string, { char: string; color: string; count: number }>();
  let pixelCount = 0;
  for (const row of frame.rows) for (const ch of row) {
    const color = palette[ch];
    if (ch === '.' || !color) continue;
    pixelCount++;
    const normalized = normalizeColor(color)!;
    const key = `${ch}\0${normalized}`;
    const current = colors.get(key) ?? { char: ch, color: normalized, count: 0 };
    current.count++;
    colors.set(key, current);
  }
  const anchors: Record<string, SpriteAnchor> = {};
  for (const [name, group] of Object.entries(frame.file.anchors ?? {})) {
    const points = group[frame.animation] ?? group[frame.concreteAnimation];
    const point = points?.[frame.frame];
    if (point) anchors[name] = { ...point };
  }
  return {
    path: frame.path,
    animation: frame.animation,
    concreteAnimation: frame.concreteAnimation,
    frame: frame.frame,
    layerId: frame.layerId,
    size: { w: frame.rows[0].length, h: frame.rows.length },
    pixelCount,
    bounds: frameBounds(frame.rows, palette),
    colors: options.colors === false
      ? undefined
      : [...colors.values()].sort((a, b) => b.count - a.count || a.char.localeCompare(b.char)),
    components: options.components ? frameComponents(frame.rows, palette) : undefined,
    anchors,
  };
}

export function inspectSpriteAgentDocument(
  workspace: SpriteAgentWorkspace,
  queries: SpriteAgentFrameQuery[] = [],
): SpriteAgentDocumentInspection {
  validateSpriteEditorDocument(workspace.active);
  const file = workspace.active;
  return {
    path: workspace.activePath,
    size: spriteDocumentFrameSize(file),
    animations: Object.keys(file.anims).map((name) => {
      const timing = resolveAnimTiming(file, name)!;
      return {
        name,
        concrete: resolveAnimName(file, name),
        fps: timing.fps,
        frameCount: timing.frameCount,
        loop: timing.loop !== false,
      };
    }),
    layers: isLayeredSpriteFile(file)
      ? file.layers.map((layer) => ({
        id: layer.id,
        name: layer.name,
        tag: layer.tag,
        composition: layer.composition ?? 'base',
      }))
      : [{ id: 'base', name: 'Base', tag: file.renderTag ?? 'base', composition: 'base' }],
    anchors: Object.keys(file.anchors ?? {}),
    frames: queries.map((query) => inspectResolvedFrame(resolveFrame(workspace, query), query)),
  };
}

function samePoint(a: SpriteAnchor | undefined, b: SpriteAnchor): boolean {
  return Boolean(a) && a!.x === b.x && a!.y === b.y && a!.angle === b.angle;
}

function executeCommand(workspace: SpriteAgentWorkspace, command: SpriteAgentCommand): {
  result: SpriteAgentCommandResult;
  cursor?: SpriteAgentCursor;
} {
  switch (command.op) {
    case 'layer.ensure':
      return { result: ensureLayer(workspace.active, command) };

    case 'animation.materialize': {
      const source = materializeSpriteAnimationAlias(workspace.active, nonEmpty(command.animation, 'animation'));
      return {
        result: { op: command.op, changed: true, detail: { animation: command.animation, source } },
        cursor: { animation: command.animation, frame: 0 },
      };
    }

    case 'frame.insert': {
      const frame = insertSpriteFrame(workspace.active, command.animation, command.index, command.mode ?? 'empty');
      return {
        result: { op: command.op, changed: true, detail: { animation: command.animation, frame } },
        cursor: { animation: command.animation, frame },
      };
    }

    case 'frame.remove': {
      const frame = removeSpriteFrame(workspace.active, command.animation, command.index);
      return {
        result: { op: command.op, changed: true, detail: { animation: command.animation, frame } },
        cursor: { animation: command.animation, frame },
      };
    }

    case 'frame.move': {
      const frame = moveSpriteFrame(workspace.active, command.animation, command.from, command.to);
      return {
        result: { op: command.op, changed: command.from !== command.to, detail: { animation: command.animation, frame } },
        cursor: { animation: command.animation, frame },
      };
    }

    case 'frame.clear': {
      let count = 0;
      const target = command.target;
      const layerIds = isLayeredSpriteFile(workspace.active) && target.layerId === '*'
        ? workspace.active.layers.map((layer) => layer.id)
        : [target.layerId];
      for (const layerId of layerIds) {
        const frame = resolveFrame(workspace, { ...target, layerId: layerId === '*' ? undefined : layerId }, true);
        const cleared = clearRows(frame.rows, resolvedPalette(frame.file), command.region);
        setFrameRows(frame, cleared.rows);
        count += cleared.count;
      }
      return {
        result: { op: command.op, changed: count > 0, detail: { clearedPixels: count, layers: layerIds } },
        cursor: { animation: target.animation, frame: target.frame, layerId: target.layerId === '*' ? undefined : target.layerId },
      };
    }

    case 'frame.copy': {
      const source = resolveFrame(workspace, command.from);
      const target = resolveFrame(workspace, command.to, true);
      const sourceClip = extractClip(source, command.region);
      const clip = transformClip(sourceClip, command.transform);
      const pasted = pasteClip(
        target, clip, command.to.x, command.to.y,
        command.mode ?? 'over', command.paletteOverflow ?? 'error', command.colorMap,
      );
      return {
        result: {
          op: command.op,
          changed: pasted.changedPixels > 0,
          detail: { sourceBounds: sourceClip.bounds, ...pasted },
        },
        cursor: { animation: command.to.animation, frame: command.to.frame, layerId: command.to.layerId },
      };
    }

    case 'frame.copyAligned': {
      const source = resolveFrame(workspace, command.from);
      const target = resolveFrame(workspace, command.to, true);
      const sourceClip = extractClip(source, command.region);
      const sourceStart = {
        x: finite(command.sourceAxis.start.x, 'sourceAxis.start.x'),
        y: finite(command.sourceAxis.start.y, 'sourceAxis.start.y'),
      };
      const sourceEnd = {
        x: finite(command.sourceAxis.end.x, 'sourceAxis.end.x'),
        y: finite(command.sourceAxis.end.y, 'sourceAxis.end.y'),
      };
      const targetStart = {
        x: finite(command.targetAxis.start.x, 'targetAxis.start.x'),
        y: finite(command.targetAxis.start.y, 'targetAxis.start.y'),
      };
      const targetEnd = {
        x: finite(command.targetAxis.end.x, 'targetAxis.end.x'),
        y: finite(command.targetAxis.end.y, 'targetAxis.end.y'),
      };
      const sourceDx = sourceEnd.x - sourceStart.x;
      const sourceDy = sourceEnd.y - sourceStart.y;
      const targetDx = targetEnd.x - targetStart.x;
      const targetDy = targetEnd.y - targetStart.y;
      const sourceLength = Math.hypot(sourceDx, sourceDy);
      const targetLength = Math.hypot(targetDx, targetDy);
      if (sourceLength <= 1e-6) throw new Error('sourceAxis endpoints must be distinct');
      if (targetLength <= 1e-6) throw new Error('targetAxis endpoints must be distinct');
      const scale = targetLength / sourceLength;
      const rotate = (Math.atan2(targetDy, targetDx) - Math.atan2(sourceDy, sourceDx)) * 180 / Math.PI;
      const transform = { rotate, scaleX: scale, scaleY: scale };
      const geometry = clipTransformGeometry(sourceClip, transform);
      const transformedStart = transformClipPoint(sourceClip, geometry, sourceStart, 'sourceAxis.start');
      const transformedEnd = transformClipPoint(sourceClip, geometry, sourceEnd, 'sourceAxis.end');
      const clip = transformClip(sourceClip, transform);
      const idealX = targetStart.x - transformedStart.x;
      const idealY = targetStart.y - transformedStart.y;
      const x = Math.round(idealX);
      const y = Math.round(idealY);
      const mappedStart = { x: x + transformedStart.x, y: y + transformedStart.y };
      const mappedEnd = { x: x + transformedEnd.x, y: y + transformedEnd.y };
      const startError = Math.hypot(mappedStart.x - targetStart.x, mappedStart.y - targetStart.y);
      const endError = Math.hypot(mappedEnd.x - targetEnd.x, mappedEnd.y - targetEnd.y);
      const endpointError = Math.max(startError, endError);
      const maxEndpointError = finite(command.maxEndpointError ?? 0.75, 'maxEndpointError');
      if (maxEndpointError < 0) throw new Error('maxEndpointError cannot be negative');
      if (endpointError > maxEndpointError + 1e-9) {
        throw new Error(`aligned endpoint error ${endpointError.toFixed(4)}px exceeds ${maxEndpointError}px`);
      }
      const pasted = pasteClip(
        target, clip, x, y,
        command.mode ?? 'over', command.paletteOverflow ?? 'error', command.colorMap,
      );
      return {
        result: {
          op: command.op,
          changed: pasted.changedPixels > 0,
          detail: {
            sourceBounds: sourceClip.bounds,
            transform,
            placement: { x, y, idealX, idealY },
            sourceAxis: command.sourceAxis,
            targetAxis: command.targetAxis,
            mappedAxis: { start: mappedStart, end: mappedEnd },
            endpointError: { start: startError, end: endError, max: endpointError },
            ...pasted,
          },
        },
        cursor: { animation: command.to.animation, frame: command.to.frame, layerId: command.to.layerId },
      };
    }

    case 'frame.remapColors': {
      const target = resolveFrame(workspace, command.target, true);
      const palette = resolvedPalette(target.file);
      const { bounds, mask } = command.region
        ? regionMask(target.rows, palette, command.region)
        : { bounds: { x: 0, y: 0, w: target.rows[0].length, h: target.rows.length }, mask: target.rows.map((row) => '1'.repeat(row.length)) };
      const normalizedMap = new Map(Object.entries(command.colors).map(([from, to]) => [
        normalizeColor(from, 'colors key')!, normalizeColor(to, 'colors value'),
      ]));
      const rows = target.rows.map((row) => [...row]);
      let changedPixels = 0;
      let addedColors = 0;
      let approximatedColors = 0;
      const remap = new Map<string, string>();
      for (let y = 0; y < bounds.h; y++) for (let x = 0; x < bounds.w; x++) {
        if (mask[y][x] !== '1') continue;
        const tx = bounds.x + x;
        const ty = bounds.y + y;
        const ch = rows[ty][tx];
        const color = palette[ch];
        if (!color) continue;
        const replacement = normalizedMap.get(normalizeColor(color)!);
        if (replacement === undefined) continue;
        let mapped = remap.get(ch);
        if (!mapped) {
          const allocated = paletteChar(target.file, replacement, command.paletteOverflow ?? 'error');
          mapped = allocated.char;
          remap.set(ch, mapped);
          if (allocated.added) addedColors++;
          if (allocated.approximated) approximatedColors++;
        }
        if (rows[ty][tx] !== mapped) {
          rows[ty][tx] = mapped;
          changedPixels++;
        }
      }
      setFrameRows(target, rows.map((row) => row.join('')));
      return {
        result: { op: command.op, changed: changedPixels > 0, detail: { changedPixels, addedColors, approximatedColors } },
        cursor: { animation: command.target.animation, frame: command.target.frame, layerId: command.target.layerId },
      };
    }

    case 'pixel.set': {
      const target = resolveFrame(workspace, command.target, true);
      const rows = target.rows.map((row) => [...row]);
      let changedPixels = 0;
      let addedColors = 0;
      let approximatedColors = 0;
      for (const pixel of command.pixels) {
        const x = integer(pixel.x, 'pixel.x');
        const y = integer(pixel.y, 'pixel.y');
        if (x >= rows[0].length || y >= rows.length) throw new Error(`pixel ${x},${y} exceeds frame bounds`);
        const allocated = paletteChar(target.file, pixel.color, command.paletteOverflow ?? 'error');
        if (allocated.added) addedColors++;
        if (allocated.approximated) approximatedColors++;
        if (rows[y][x] !== allocated.char) {
          rows[y][x] = allocated.char;
          changedPixels++;
        }
      }
      setFrameRows(target, rows.map((row) => row.join('')));
      return {
        result: { op: command.op, changed: changedPixels > 0, detail: { changedPixels, addedColors, approximatedColors } },
        cursor: { animation: command.target.animation, frame: command.target.frame, layerId: command.target.layerId },
      };
    }

    case 'anchor.set': {
      const anchor = nonEmpty(command.anchor, 'anchor');
      const animation = nonEmpty(command.animation, 'animation');
      const timing = resolveAnimTiming(workspace.active, animation);
      if (!timing) throw new Error(`unknown animation "${animation}"`);
      const frame = integer(command.frame, 'frame');
      if (frame >= timing.frameCount) throw new Error(`anchor frame ${frame} exceeds "${animation}"`);
      const point = {
        x: finite(command.point.x, 'point.x'),
        y: finite(command.point.y, 'point.y'),
        ...(command.point.angle === undefined ? {} : { angle: finite(command.point.angle, 'point.angle') }),
      };
      const concrete = resolveAnimName(workspace.active, animation);
      const group = (workspace.active.anchors ??= {})[anchor] ??= {};
      const points = group[concrete] ??= Array.from({ length: timing.frameCount }, () => ({ x: 0, y: 0 }));
      const changed = !samePoint(points[frame], point);
      points[frame] = point;
      return {
        result: { op: command.op, changed, detail: { anchor, animation: concrete, frame, point } },
        cursor: { animation, frame },
      };
    }

    case 'assert.frame': {
      const inspection = inspectResolvedFrame(resolveFrame(workspace, command.target), { components: true, colors: false });
      const expected = command.expected;
      if (expected.pixelCount !== undefined && inspection.pixelCount !== expected.pixelCount) {
        throw new Error(`assert.frame pixelCount expected ${expected.pixelCount}, got ${inspection.pixelCount}`);
      }
      if (expected.componentCount !== undefined && inspection.components?.length !== expected.componentCount) {
        throw new Error(`assert.frame componentCount expected ${expected.componentCount}, got ${inspection.components?.length ?? 0}`);
      }
      if (expected.bounds !== undefined && JSON.stringify(inspection.bounds) !== JSON.stringify(expected.bounds)) {
        throw new Error(`assert.frame bounds expected ${JSON.stringify(expected.bounds)}, got ${JSON.stringify(inspection.bounds)}`);
      }
      return {
        result: {
          op: command.op,
          changed: false,
          detail: {
            passed: true,
            actual: {
              pixelCount: inspection.pixelCount,
              bounds: inspection.bounds,
              componentCount: inspection.components?.length ?? 0,
            },
          },
        },
      };
    }

    case 'assert.anchor': {
      const concrete = resolveAnimName(workspace.active, command.animation);
      const actual = workspace.active.anchors?.[command.anchor]?.[command.animation]?.[command.frame]
        ?? workspace.active.anchors?.[command.anchor]?.[concrete]?.[command.frame];
      if (!samePoint(actual, command.expected)) {
        throw new Error(`assert.anchor expected ${JSON.stringify(command.expected)}, got ${JSON.stringify(actual ?? null)}`);
      }
      return { result: { op: command.op, changed: false, detail: { passed: true, actual } } };
    }

    default:
      throw new Error(`unsupported command operation "${String((command as { op?: unknown }).op)}"`);
  }
}

function validateCommandEnvelope(value: unknown): asserts value is SpriteAgentCommand {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('command must be an object');
  }
  const op = (value as { op?: unknown }).op;
  if (typeof op !== 'string' || !SPRITE_AGENT_OPERATION_SET.has(op)) {
    throw new Error(`unsupported command operation "${String(op)}"`);
  }
}

export function spriteAgentSourcePaths(commands: readonly unknown[]): string[] {
  const paths = new Set<string>();
  for (const command of commands) {
    validateCommandEnvelope(command);
    if ((command.op === 'frame.copy' || command.op === 'frame.copyAligned') && command.from?.path) {
      paths.add(command.from.path);
    }
  }
  return [...paths];
}

export function applySpriteAgentTransaction(
  workspace: SpriteAgentWorkspace,
  transaction: SpriteAgentTransaction,
): SpriteAgentTransactionResult {
  validateSpriteEditorDocument(workspace.active);
  const protocolVersion = (transaction as SpriteAgentTransaction & { protocolVersion?: unknown }).protocolVersion;
  if (protocolVersion !== undefined && protocolVersion !== SPRITE_AGENT_PROTOCOL_VERSION) {
    throw new Error(`unsupported protocolVersion ${String(protocolVersion)}; expected ${SPRITE_AGENT_PROTOCOL_VERSION}`);
  }
  if (!Array.isArray(transaction.commands) || transaction.commands.length < 1) {
    throw new Error('transaction commands must be a non-empty array');
  }
  if (transaction.commands.length > SPRITE_AGENT_MAX_COMMANDS) {
    throw new Error(`transaction cannot exceed ${SPRITE_AGENT_MAX_COMMANDS} commands`);
  }
  if (transaction.inspect !== undefined && !Array.isArray(transaction.inspect)) {
    throw new Error('transaction inspect must be an array');
  }
  if ((transaction.inspect?.length ?? 0) > SPRITE_AGENT_MAX_INSPECTIONS) {
    throw new Error(`transaction cannot inspect more than ${SPRITE_AGENT_MAX_INSPECTIONS} frames`);
  }
  const before = JSON.stringify(workspace.active);
  const active = structuredClone(workspace.active);
  const executionWorkspace: SpriteAgentWorkspace = { ...workspace, active };
  const results: SpriteAgentCommandResult[] = [];
  let cursor: SpriteAgentCursor | undefined;
  for (let index = 0; index < transaction.commands.length; index++) {
    try {
      const command = transaction.commands[index];
      validateCommandEnvelope(command);
      const executed = executeCommand(executionWorkspace, command);
      results.push(executed.result);
      cursor = executed.cursor ?? cursor;
    } catch (error) {
      const op = (transaction.commands[index] as { op?: unknown } | null | undefined)?.op;
      throw new Error(`command ${index + 1} (${String(op)}): ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  validateSpriteEditorDocument(active);
  const changed = JSON.stringify(active) !== before;
  return {
    file: active,
    changed,
    cursor,
    results,
    inspection: transaction.inspect
      ? inspectSpriteAgentDocument({ ...executionWorkspace, active }, transaction.inspect)
      : undefined,
  };
}
