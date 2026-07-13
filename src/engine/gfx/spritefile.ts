import { sprite, epx, type Palette } from './sprite';
import type { AnimSet } from './animation';

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

export interface SpriteFile {
  /** Char → color overrides layered on the base palette. */
  palette?: Palette;
  /** EPX-upscale twice (4x) at load. Default true. */
  hd?: boolean;
  anims: Record<string, SpriteAnimData>;
}

export interface LoadedSprite {
  /** One baked frame canvas of an animation (default frame 0). */
  frame(anim: string, i?: number): HTMLCanvasElement;
  /** All baked frames of an animation. */
  frames(anim: string): HTMLCanvasElement[];
  /** Animation names in the file. */
  names(): string[];
  /** An AnimSet ready for `withFacing`/`frameAt`. */
  animSet(): AnimSet;
}

/**
 * Bake a SpriteFile into canvases. Frames are baked lazily and cached, so
 * asking for the same frame twice is free.
 */
export function loadSprite(file: SpriteFile, base: Palette = {}): LoadedSprite {
  const pal: Palette = { ...base, ...(file.palette ?? {}) };
  const bake = (rows: string[]): HTMLCanvasElement =>
    file.hd === false ? sprite(rows, pal) : sprite(epx(epx(rows)), pal);

  const cache = new Map<string, HTMLCanvasElement[]>();
  const framesOf = (name: string): HTMLCanvasElement[] => {
    let baked = cache.get(name);
    if (!baked) {
      baked = (file.anims[name]?.frames ?? []).map(bake);
      cache.set(name, baked);
    }
    return baked;
  };

  return {
    frame: (name, i = 0) => framesOf(name)[i],
    frames: framesOf,
    names: () => Object.keys(file.anims),
    animSet: () => {
      const set: AnimSet = {};
      for (const [name, a] of Object.entries(file.anims)) {
        set[name] = { frames: framesOf(name), fps: a.fps, loop: a.loop };
      }
      return set;
    },
  };
}
