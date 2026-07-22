import { sprite, epx, type Palette } from './sprite';
import type { AnimSet } from './animation';
import type { Rect } from '../math/rect';

/**
 * The on-disk sprite format: one JSON file per sprite/character, holding a
 * palette and a set of named animations. It's the exact format the sprite
 * editor exports and imports, so art round-trips edit → play with no code.
 *
 * Frames are 1x text grids (rows of palette characters); `hd` upscales
 * them via iterated EPX to 4x texel density — the game's art density — at
 * load time. Set `hd: false` for already-dense art.
 */
export interface SpriteAnimData {
  fps: number;
  /** Each frame is a list of equal-length rows of palette characters. */
  frames: string[][];
  /** If false, hold the last frame instead of looping. Default true. */
  loop?: boolean;
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

export interface SpriteFile extends SpriteGeometry {
  /** Char → color overrides layered on the base palette. */
  palette?: Palette;
  /** EPX-upscale twice (4x) at load. Default true. */
  hd?: boolean;
  /**
   * An animation is authored frames — or a STRING naming another
   * animation in this file to borrow wholesale. Aliases are what let a
   * moveset demand its own animation per move ("plunge", "upper"...)
   * without every sheet paying for duplicate frames on day one:
   * `"plunge": "attack"` is one line and zero bytes of art, and a real
   * `plunge` animation replaces it whenever an artist gets there.
   */
  anims: Record<string, SpriteAnimData | string>;
}

/**
 * Follow an anim entry to authored frames. A dangling alias or a cycle
 * is a content bug and throws with the chain spelled out.
 */
export function resolveAnim(file: SpriteFile, name: string): SpriteAnimData | undefined {
  const chain: string[] = [name];
  let entry = file.anims[name];
  while (typeof entry === 'string') {
    chain.push(entry);
    if (chain.length > 8 || chain.slice(0, -1).includes(entry)) {
      throw new Error(`sprite anim alias cycle: ${chain.join(' -> ')}`);
    }
    const next: SpriteAnimData | string | undefined = file.anims[entry];
    if (next === undefined) throw new Error(`sprite anim alias to nowhere: ${chain.join(' -> ')}`);
    entry = next;
  }
  return entry;
}

export interface LoadedSprite {
  /** Physical drawn width in logical units. */
  w: number;
  /** Physical drawn height in logical units. */
  h: number;
  /** Collision hitbox relative to drawing origin. */
  hitbox: Rect;
  /** One baked frame canvas of an animation (default frame 0). */
  frame(anim: string, i?: number): HTMLCanvasElement;
  /** All baked frames of an animation. */
  frames(anim: string): HTMLCanvasElement[];
  /** Animation names in the file. */
  names(): string[];
  /** An AnimSet ready for `withFacing`/`frameAt`. */
  animSet(): AnimSet;
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

/**
 * Bake a SpriteFile into canvases. Frames are baked lazily and cached, so
 * asking for the same frame twice is free.
 */
export function loadSprite(file: SpriteFile, base: Palette = {}): LoadedSprite {
  const pal: Palette = { ...base, ...(file.palette ?? {}) };
  const bake = (rows: string[]): HTMLCanvasElement =>
    file.hd === false ? sprite(rows, pal) : sprite(epx(epx(rows)), pal);

  // `hd: false` means the grid is already authored at the engine's 4x
  // texel density, so its natural logical size is one quarter of the grid.
  const firstAnim = resolveAnim(file, Object.keys(file.anims)[0]);
  const firstFrame = firstAnim?.frames[0] ?? [];
  const cellH = firstFrame.length || 1;
  const cellW = Math.max(1, ...firstFrame.map((row) => row.length));
  const density = file.hd === false ? 4 : 1;
  const geometry = resolveSpriteGeometry(file, cellW / density, cellH / density);

  // Aliases cache under their TARGET's name, so "plunge": "attack"
  // costs no second bake of the same frames.
  const cache = new Map<string, HTMLCanvasElement[]>();
  const framesOf = (name: string): HTMLCanvasElement[] => {
    let target = name;
    let entry = file.anims[name];
    while (typeof entry === 'string') {
      target = entry;
      entry = file.anims[entry];
    }
    let baked = cache.get(target);
    if (!baked) {
      baked = (resolveAnim(file, name)?.frames ?? []).map(bake);
      cache.set(target, baked);
    }
    return baked;
  };

  return {
    ...geometry,
    frame: (name, i = 0) => framesOf(name)[i],
    frames: framesOf,
    names: () => Object.keys(file.anims),
    animSet: () => {
      const set: AnimSet = {};
      for (const name of Object.keys(file.anims)) {
        const a = resolveAnim(file, name);
        if (!a) continue;
        set[name] = { frames: framesOf(name), fps: a.fps, loop: a.loop };
      }
      return set;
    },
  };
}
