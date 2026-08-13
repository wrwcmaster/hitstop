import { sprite, epx, type Palette } from './sprite';
import type { AnimSet } from './animation';
import type { Rect } from '../math/rect';

/**
 * The on-disk sprite format. Flat files keep pixels beside animation timing;
 * layered files keep one shared timeline and place pixels in named tracks.
 * Both are baked to the same LoadedSprite API, so authoring structure never
 * leaks into actors or renderers.
 */
export interface SpriteAnimData {
  fps: number;
  /** Each frame is a list of equal-length rows of palette characters. */
  frames: string[][];
  /** If false, hold the last frame instead of looping. Default true. */
  loop?: boolean;
}

/** Animation timing for a layered file. Pixel frames live in layer tracks. */
export interface LayeredSpriteAnimData {
  fps: number;
  frameCount: number;
  /** If false, hold the last frame instead of looping. Default true. */
  loop?: boolean;
}

/** One bottom-to-top authoring layer in a layered sprite source file. */
export interface SpriteLayerData {
  /** Stable machine id used by drafts, undo, and collaboration. */
  id: string;
  /** Freely editable display label. */
  name: string;
  /** Shared render band used when this sprite is composed with attachments. */
  tag: string;
  /** Concrete animation name to one text-grid frame per timeline frame. */
  tracks: Record<string, string[][]>;
}

/** Draw size and collision bounds, both in logical game pixels. */
export interface SpriteGeometry {
  /** Physical drawn size in logical units. */
  w?: number;
  h?: number;
  /** Optional collision hitbox definition (defaults to full physical size). */
  hitbox?: {
    x?: number;
    y?: number;
    w?: number;
    h?: number;
  };
}

/** A named attachment point in logical pixels from the sprite's top-left. */
export interface SpriteAnchor {
  x: number;
  y: number;
  angle?: number;
}

/** Anchor name -> animation name -> one point per animation frame. */
export type SpriteAnchors = Record<string, Record<string, SpriteAnchor[]>>;

/** A semantic attachment socket resolved through a frame-aligned anchor. */
export interface SpriteAttachmentSlot {
  anchor: string;
}

interface SpriteFileBase extends SpriteGeometry {
  /** Character-to-color overrides layered on the base palette. */
  palette?: Palette;
  /** EPX-upscale twice (4x) at load. Default true. */
  hd?: boolean;
  /** Frame-aligned attachment points (hands, head, muzzle, etc.). */
  anchors?: SpriteAnchors;
  /** Named sockets used by independently authored attached sprites. */
  attachmentSlots?: Record<string, SpriteAttachmentSlot>;
  /** Shared render band for a flat sprite. Layered sprites tag each layer. */
  renderTag?: string;
}

/** Original single-layer format. Existing content remains byte-compatible. */
export interface FlatSpriteFile extends SpriteFileBase {
  layers?: never;
  /** Authored animation, or a string naming another animation to borrow. */
  anims: Record<string, SpriteAnimData | string>;
}

/** Layer-preserving authoring format. Timing is shared by every layer. */
export interface LayeredSpriteFile extends SpriteFileBase {
  anims: Record<string, LayeredSpriteAnimData | string>;
  /** Ordered bottom to top. Runtime baking flattens these into one frame. */
  layers: SpriteLayerData[];
}

export type SpriteFile = FlatSpriteFile | LayeredSpriteFile;

export function isLayeredSpriteFile(file: SpriteFile): file is LayeredSpriteFile {
  return Array.isArray((file as LayeredSpriteFile).layers);
}

/** Follow aliases once for timing, pixels, anchors, and layer tracks. */
export function resolveAnimName(file: SpriteFile, name: string): string {
  const chain: string[] = [name];
  let target = name;
  let entry: SpriteAnimData | LayeredSpriteAnimData | string | undefined = file.anims[target];
  while (typeof entry === 'string') {
    target = entry;
    chain.push(target);
    if (chain.length > 8 || chain.slice(0, -1).includes(target)) {
      throw new Error(`sprite anim alias cycle: ${chain.join(' -> ')}`);
    }
    entry = file.anims[target];
    if (entry === undefined) throw new Error(`sprite anim alias to nowhere: ${chain.join(' -> ')}`);
  }
  return target;
}

function positiveInteger(value: number, field: string): number {
  if (!Number.isInteger(value) || value < 1) throw new Error(`sprite: ${field} must be a positive integer`);
  return value;
}

/** Validate the invariants that keep every layer on one shared timeline. */
export function validateLayeredSpriteFile(file: LayeredSpriteFile): void {
  if (!file.layers.length) throw new Error('sprite: layered file needs at least one layer');
  const ids = new Set<string>();
  for (const layer of file.layers) {
    if (!layer.id?.trim()) throw new Error('sprite: layer id must be non-empty');
    if (ids.has(layer.id)) throw new Error(`sprite: duplicate layer id "${layer.id}"`);
    ids.add(layer.id);
    if (!layer.name?.trim()) throw new Error(`sprite: layer "${layer.id}" needs a name`);
    if (!layer.tag?.trim()) throw new Error(`sprite: layer "${layer.id}" needs a render tag`);
    if (!layer.tracks || typeof layer.tracks !== 'object') {
      throw new Error(`sprite: layer "${layer.id}" needs tracks`);
    }
  }

  let expectedW: number | undefined;
  let expectedH: number | undefined;
  for (const [name, entry] of Object.entries(file.anims)) {
    if (typeof entry === 'string') continue;
    const count = positiveInteger(entry.frameCount, `animation "${name}" frameCount`);
    if (!Number.isFinite(entry.fps) || entry.fps <= 0) {
      throw new Error(`sprite: animation "${name}" fps must be positive`);
    }
    for (const layer of file.layers) {
      const frames = layer.tracks[name];
      if (!Array.isArray(frames) || frames.length !== count) {
        throw new Error(`sprite: layer "${layer.id}.${name}" expected ${count} frames, got ${frames?.length ?? 0}`);
      }
      for (let frame = 0; frame < frames.length; frame++) {
        const rows = frames[frame];
        if (!Array.isArray(rows) || !rows.length || rows.some((row) => typeof row !== 'string')) {
          throw new Error(`sprite: layer "${layer.id}.${name}" frame ${frame + 1} needs text rows`);
        }
        const width = rows[0].length;
        if (!width || rows.some((row) => row.length !== width)) {
          throw new Error(`sprite: layer "${layer.id}.${name}" frame ${frame + 1} rows must have equal width`);
        }
        expectedW ??= width;
        expectedH ??= rows.length;
        if (width !== expectedW || rows.length !== expectedH) {
          throw new Error(`sprite: layer "${layer.id}.${name}" frame ${frame + 1} must be ${expectedW}x${expectedH}`);
        }
      }
    }
  }

  for (const name of Object.keys(file.anims)) resolveAnimName(file, name);
}

/** Render tags contributed by a sprite, in first-occurrence layer order. */
export function spriteLayerTags(file: SpriteFile): string[] {
  if (!isLayeredSpriteFile(file)) return [file.renderTag ?? 'base'];
  return [...new Set(file.layers.map((layer) => layer.tag))];
}

/** Shared animation timing regardless of whether pixels are flat or layered. */
export function resolveAnimTiming(
  file: SpriteFile,
  name: string,
): { fps: number; frameCount: number; loop?: boolean } | undefined {
  if (!(name in file.anims)) return undefined;
  const target = resolveAnimName(file, name);
  const entry: SpriteAnimData | LayeredSpriteAnimData | string | undefined = file.anims[target];
  if (!entry || typeof entry === 'string') return undefined;
  if (isLayeredSpriteFile(file)) {
    const layered = entry as LayeredSpriteAnimData;
    return { fps: layered.fps, frameCount: layered.frameCount, loop: layered.loop };
  }
  const flat = entry as SpriteAnimData;
  return { fps: flat.fps, frameCount: flat.frames.length, loop: flat.loop };
}

/**
 * Composite one authored frame on character grids before rasterization.
 * `include` is used by tools for temporary hide/solo state; gameplay omits it.
 */
export function compositeSpriteFrame(
  file: SpriteFile,
  name: string,
  frame: number,
  base: Palette = {},
  include: (layer: SpriteLayerData) => boolean = () => true,
): string[] | undefined {
  if (!(name in file.anims)) return undefined;
  const target = resolveAnimName(file, name);
  if (!isLayeredSpriteFile(file)) {
    const entry = file.anims[target];
    return typeof entry === 'string' ? undefined : entry?.frames[frame]?.slice();
  }

  const timeline = file.anims[target];
  if (!timeline || typeof timeline === 'string' || frame < 0 || frame >= timeline.frameCount) return undefined;
  const first = file.layers[0].tracks[target][frame];
  const out = first.map((row) => '.'.repeat(row.length).split(''));
  const palette = { ...base, ...(file.palette ?? {}) };
  for (const layer of file.layers) {
    if (!include(layer)) continue;
    const rows = layer.tracks[target][frame];
    for (let y = 0; y < rows.length; y++) for (let x = 0; x < rows[y].length; x++) {
      const ch = rows[y][x];
      // Unknown characters may come from the caller's base palette. Preserve
      // them here; final raster drawing decides whether they paint.
      if (ch !== '.' && palette[ch] !== null) out[y][x] = ch;
    }
  }
  return out.map((row) => row.join(''));
}

/** Composite only the layers assigned to one shared render tag. */
export function compositeSpriteTagFrame(
  file: SpriteFile,
  name: string,
  frame: number,
  tag: string,
  base: Palette = {},
): string[] | undefined {
  if (!isLayeredSpriteFile(file)) {
    return tag === (file.renderTag ?? 'base') ? compositeSpriteFrame(file, name, frame, base) : undefined;
  }
  if (!file.layers.some((layer) => layer.tag === tag)) return undefined;
  return compositeSpriteFrame(file, name, frame, base, (layer) => layer.tag === tag);
}

/** Composite a sprite by shared render-band order rather than layer z-order. */
export function compositeSpriteFrameByTags(
  file: SpriteFile,
  name: string,
  frame: number,
  tagOrder: readonly string[],
  base: Palette = {},
  include: (layer: SpriteLayerData) => boolean = () => true,
): string[] | undefined {
  if (!isLayeredSpriteFile(file)) return compositeSpriteFrame(file, name, frame, base);
  const missing = spriteLayerTags(file).filter((tag) => !tagOrder.includes(tag));
  if (missing.length) throw new Error(`sprite: render tag order is missing ${missing.map((tag) => `"${tag}"`).join(', ')}`);
  const target = resolveAnimName(file, name);
  const timeline = file.anims[target];
  if (!timeline || typeof timeline === 'string' || frame < 0 || frame >= timeline.frameCount) return undefined;
  const first = file.layers[0].tracks[target][frame];
  const out = first.map((row) => '.'.repeat(row.length).split(''));
  const palette = { ...base, ...(file.palette ?? {}) };
  for (const tag of tagOrder) for (const layer of file.layers) {
    if (layer.tag !== tag || !include(layer)) continue;
    const rows = layer.tracks[target][frame];
    for (let y = 0; y < rows.length; y++) for (let x = 0; x < rows[y].length; x++) {
      const ch = rows[y][x];
      if (ch !== '.' && palette[ch] !== null) out[y][x] = ch;
    }
  }
  return out.map((row) => row.join(''));
}

/** Resolve an animation to flat frames for all existing consumers. */
export function resolveAnim(file: SpriteFile, name: string, base: Palette = {}): SpriteAnimData | undefined {
  const timing = resolveAnimTiming(file, name);
  if (!timing) return undefined;
  if (!isLayeredSpriteFile(file)) {
    const entry = file.anims[resolveAnimName(file, name)];
    return typeof entry === 'string' ? undefined : entry;
  }
  validateLayeredSpriteFile(file);
  return {
    fps: timing.fps,
    loop: timing.loop,
    frames: Array.from(
      { length: timing.frameCount },
      (_, frame) => compositeSpriteFrame(file, name, frame, base)!,
    ),
  };
}

export interface LoadedSprite {
  /** Physical drawn width in logical units. */
  w: number;
  /** Physical drawn height in logical units. */
  h: number;
  /** Collision hitbox relative to drawing origin. */
  hitbox: Rect;
  /** Resolve a named point, following animation aliases like frame art. */
  anchor?(name: string, anim: string, frame?: number): SpriteAnchor | undefined;
  /** Resolve a semantic attachment socket to its anchor name. */
  slot?(name: string): SpriteAttachmentSlot | undefined;
  /** One baked frame canvas of an animation (default frame 0). */
  frame(anim: string, i?: number): HTMLCanvasElement;
  /** All baked frames of an animation. */
  frames(anim: string): HTMLCanvasElement[];
  /** Animation names in the file. */
  names(): string[];
  /** An AnimSet ready for `withFacing`/`frameAt`. */
  animSet(): AnimSet;
  /** Render tags authored by this sprite (`renderTag`, or `base` when absent). */
  tags(): string[];
  /** All baked frames for one render tag and animation. */
  tagFrames(tag: string, anim: string): HTMLCanvasElement[];
  /** An AnimSet containing only one render tag. */
  tagAnimSet(tag: string): AnimSet;
}

/** Resolve optional sprite metadata against the frame's natural draw size. */
export function resolveSpriteGeometry(
  geometry: SpriteGeometry,
  naturalW: number,
  naturalH: number,
): Pick<LoadedSprite, 'w' | 'h' | 'hitbox'> {
  const positive = (value: number | undefined, fallback: number, field: string): number => {
    const resolved = value ?? fallback;
    if (!Number.isFinite(resolved) || resolved <= 0) {
      throw new Error(`sprite: ${field} must be a positive finite number`);
    }
    return resolved;
  };
  const finite = (value: number | undefined, fallback: number, field: string): number => {
    const resolved = value ?? fallback;
    if (!Number.isFinite(resolved)) throw new Error(`sprite: ${field} must be finite`);
    return resolved;
  };

  const w = positive(geometry.w, naturalW, 'w');
  const h = positive(geometry.h, naturalH, 'h');
  const hb = geometry.hitbox ?? {};
  return {
    w,
    h,
    hitbox: {
      x: finite(hb.x, 0, 'hitbox.x'),
      y: finite(hb.y, 0, 'hitbox.y'),
      w: positive(hb.w, w, 'hitbox.w'),
      h: positive(hb.h, h, 'hitbox.h'),
    },
  };
}

/** Bake a SpriteFile into lazily cached canvases. */
export function loadSprite(file: SpriteFile, base: Palette = {}): LoadedSprite {
  const pal: Palette = { ...base, ...(file.palette ?? {}) };
  if (file.renderTag !== undefined && !file.renderTag.trim()) {
    throw new Error('sprite: renderTag must be non-empty');
  }
  if (isLayeredSpriteFile(file)) validateLayeredSpriteFile(file);
  for (const [pointName, animations] of Object.entries(file.anchors ?? {})) {
    for (const [animName, points] of Object.entries(animations)) {
      const timing = resolveAnimTiming(file, animName);
      if (!timing) throw new Error(`sprite anchor "${pointName}": unknown animation "${animName}"`);
      if (points.length !== timing.frameCount) {
        throw new Error(`sprite anchor "${pointName}.${animName}": expected ${timing.frameCount} frame points, got ${points.length}`);
      }
      for (const point of points) {
        if (!Number.isFinite(point.x) || !Number.isFinite(point.y)
          || (point.angle !== undefined && !Number.isFinite(point.angle))) {
          throw new Error(`sprite anchor "${pointName}.${animName}": coordinates must be finite`);
        }
      }
    }
  }
  for (const [slotName, slot] of Object.entries(file.attachmentSlots ?? {})) {
    if (!slotName.trim() || !slot?.anchor?.trim()) throw new Error('sprite attachment slots need names and anchors');
    if (!file.anchors?.[slot.anchor]) {
      throw new Error(`sprite attachment slot "${slotName}" uses unknown anchor "${slot.anchor}"`);
    }
  }
  const bake = (rows: string[]): HTMLCanvasElement =>
    file.hd === false ? sprite(rows, pal) : sprite(epx(epx(rows)), pal);

  const firstFrame = compositeSpriteFrame(file, Object.keys(file.anims)[0], 0, base) ?? [];
  const cellH = firstFrame.length || 1;
  const cellW = Math.max(1, ...firstFrame.map((row) => row.length));
  const density = file.hd === false ? 4 : 1;
  const geometry = resolveSpriteGeometry(file, cellW / density, cellH / density);

  // Aliases cache under their target, so borrowed animations cost no bake.
  const cache = new Map<string, HTMLCanvasElement[]>();
  const framesOf = (name: string): HTMLCanvasElement[] => {
    const target = resolveAnimName(file, name);
    let baked = cache.get(target);
    if (!baked) {
      const timing = resolveAnimTiming(file, target);
      baked = timing
        ? Array.from(
          { length: timing.frameCount },
          (_, frame) => bake(compositeSpriteFrame(file, target, frame, base)!),
        )
        : [];
      cache.set(target, baked);
    }
    return baked;
  };

  const tagCache = new Map<string, Map<string, HTMLCanvasElement[]>>();
  const tagFramesOf = (tag: string, name: string): HTMLCanvasElement[] => {
    const target = resolveAnimName(file, name);
    let cacheForTag = tagCache.get(tag);
    if (!cacheForTag) {
      cacheForTag = new Map<string, HTMLCanvasElement[]>();
      tagCache.set(tag, cacheForTag);
    }
    let baked = cacheForTag.get(target);
    if (!baked) {
      const timing = resolveAnimTiming(file, target);
      baked = timing && spriteLayerTags(file).includes(tag)
        ? Array.from(
          { length: timing.frameCount },
          (_, frame) => bake(compositeSpriteTagFrame(file, target, frame, tag, base)!),
        )
        : [];
      cacheForTag.set(target, baked);
    }
    return baked;
  };

  const anchorOf = (name: string, anim: string, frame = 0): SpriteAnchor | undefined => {
    const target = resolveAnimName(file, anim);
    const points = file.anchors?.[name]?.[anim] ?? file.anchors?.[name]?.[target];
    if (!points?.length) return undefined;
    return points[Math.min(Math.max(0, frame), points.length - 1)];
  };

  return {
    ...geometry,
    anchor: anchorOf,
    slot: (name) => file.attachmentSlots?.[name],
    frame: (name, i = 0) => framesOf(name)[i],
    frames: framesOf,
    names: () => Object.keys(file.anims),
    animSet: () => {
      const set: AnimSet = {};
      for (const name of Object.keys(file.anims)) {
        const timing = resolveAnimTiming(file, name);
        if (!timing) continue;
        set[name] = { frames: framesOf(name), fps: timing.fps, loop: timing.loop };
      }
      return set;
    },
    tags: () => spriteLayerTags(file),
    tagFrames: tagFramesOf,
    tagAnimSet: (tag) => {
      const set: AnimSet = {};
      for (const name of Object.keys(file.anims)) {
        const timing = resolveAnimTiming(file, name);
        if (!timing) continue;
        set[name] = { frames: tagFramesOf(tag, name), fps: timing.fps, loop: timing.loop };
      }
      return set;
    },
  };
}
