import { offscreen } from './canvas';
import type { AnimSet } from './animation';
import { resolveSpriteGeometry, type LoadedSprite, type SpriteGeometry } from './spritefile';

/**
 * PNG sprite-sheet support: slice a loaded image into animation frames.
 *
 * This is the path for full-color, high-fidelity art (e.g. a sheet drawn
 * elsewhere) that the text-grid format can't express. A `SheetDescriptor`
 * says how to cut the image (a uniform grid, or explicit rects) and which
 * frames make up each animation. `loadSheet` returns the same
 * `LoadedSprite` interface as the text-grid loader, so the game draws
 * sheet-backed sprites through exactly the same path.
 *
 * Frames are rescaled to the game's 4x texel density (so `img.width/TEXEL`
 * gives the right logical size): `texel` is how many source pixels map to
 * one logical pixel — e.g. a 32px-wide frame with `texel: 2` draws 16
 * logical px wide, matching the text-grid sprites.
 */
export interface SheetRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface SheetAnimData {
  fps: number;
  /** Frame indices (grid order, left→right, top→bottom), or rect indices. */
  frames: number[];
  loop?: boolean;
}

export interface SheetDescriptor extends SpriteGeometry {
  /** Source image filename — tooling/metadata only; runtime takes the image directly. */
  image?: string;
  /** Uniform grid cell size (px). Ignored for frames covered by `rects`. */
  frameW: number;
  frameH: number;
  /** Border around the sheet and gap between cells (px). */
  margin?: number;
  spacing?: number;
  /** Source pixels per logical pixel (default 4 = game density). */
  texel?: number;
  /** Explicit per-frame rects; when present, frame index → rects[index]. */
  rects?: SheetRect[];
  anims: Record<string, SheetAnimData>;
}

/** Bake a sprite sheet into per-frame canvases behind the LoadedSprite API. */
export function loadSheet(image: CanvasImageSource, desc: SheetDescriptor): LoadedSprite {
  const iw = (image as HTMLImageElement).width ?? 0;
  const margin = desc.margin ?? 0;
  const spacing = desc.spacing ?? 0;
  const cols = desc.frameW > 0 ? Math.max(1, Math.floor((iw - margin + spacing) / (desc.frameW + spacing))) : 1;
  // Scale source frames to the game's 4x density.
  const k = 4 / (desc.texel ?? 4);

  const rectFor = (i: number): SheetRect => {
    if (desc.rects && desc.rects[i]) return desc.rects[i];
    const c = i % cols;
    const r = Math.floor(i / cols);
    return {
      x: margin + c * (desc.frameW + spacing),
      y: margin + r * (desc.frameH + spacing),
      w: desc.frameW,
      h: desc.frameH,
    };
  };

  const cache = new Map<number, HTMLCanvasElement>();
  const bake = (i: number): HTMLCanvasElement => {
    let cv = cache.get(i);
    if (!cv) {
      const { x, y, w, h } = rectFor(i);
      const dw = Math.max(1, Math.round(w * k));
      const dh = Math.max(1, Math.round(h * k));
      const [c, g] = offscreen(dw, dh);
      g.imageSmoothingEnabled = false;
      g.drawImage(image, x, y, w, h, 0, 0, dw, dh);
      cv = c;
      cache.set(i, cv);
    }
    return cv;
  };

  const texel = desc.texel ?? 4;
  if (!Number.isFinite(texel) || texel <= 0) throw new Error('sprite sheet: texel must be positive');
  const firstFrame = Object.values(desc.anims)[0]?.frames[0] ?? 0;
  const naturalRect = rectFor(firstFrame);
  const geometry = resolveSpriteGeometry(desc, naturalRect.w / texel, naturalRect.h / texel);

  const framesOf = (name: string): HTMLCanvasElement[] => (desc.anims[name]?.frames ?? []).map(bake);

  return {
    ...geometry,
    frame: (name, i = 0) => framesOf(name)[i],
    frames: framesOf,
    names: () => Object.keys(desc.anims),
    animSet: () => {
      const set: AnimSet = {};
      for (const [name, a] of Object.entries(desc.anims)) {
        set[name] = { frames: framesOf(name), fps: a.fps, loop: a.loop };
      }
      return set;
    },
  };
}

/** Load an image from a URL (or data URI) to a decoded HTMLImageElement. */
export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`failed to load image: ${src}`));
    img.src = src;
  });
}
