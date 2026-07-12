import { flipped } from './sprite';

/**
 * Frame animation over baked sprite canvases.
 *
 * An AnimSet maps state names to frame lists + fps; `framesFor` picks the
 * current frame from an animation clock. Facing is handled by pre-baking
 * flipped copies (pixel art is tiny; memory is free).
 */
export interface Anim {
  frames: HTMLCanvasElement[];
  fps: number;
  /** If false, hold the last frame instead of looping. Default true. */
  loop?: boolean;
}

export type AnimSet = Record<string, Anim>;

export interface FacingAnimSet {
  right: AnimSet;
  left: AnimSet;
}

export function withFacing(set: AnimSet): FacingAnimSet {
  const left: AnimSet = {};
  for (const k in set) {
    left[k] = { ...set[k], frames: set[k].frames.map(flipped) };
  }
  return { right: set, left };
}

/** Current frame of animation `name` at time `t` (seconds since anim start). */
export function frameAt(set: AnimSet, name: string, t: number): HTMLCanvasElement {
  const anim = set[name];
  if (!anim) throw new Error(`unknown animation "${name}"`);
  const i = Math.floor(t * anim.fps);
  const n = anim.frames.length;
  return anim.frames[anim.loop === false ? Math.min(i, n - 1) : i % n];
}
