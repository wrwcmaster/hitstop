/**
 * Pixel-perfect canvas setup: a small fixed internal resolution scaled up
 * by an integer factor with crisp scaling, letterboxed to fit the window.
 */
export interface PixelCanvas {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  width: number;
  height: number;
}

export function createPixelCanvas(
  canvas: HTMLCanvasElement,
  width: number,
  height: number,
  /**
   * Device pixels per logical pixel. The canvas backing store is
   * width*zoom × height*zoom with a baked scale transform, so all game
   * code keeps drawing in logical coordinates while art can carry
   * `zoom`× the texel density (draw a 2×-detailed sprite at half size).
   */
  zoom = 1,
): PixelCanvas {
  canvas.width = width * zoom;
  canvas.height = height * zoom;
  const ctx = canvas.getContext('2d')!;
  ctx.setTransform(zoom, 0, 0, zoom, 0, 0);
  ctx.imageSmoothingEnabled = false;

  const fit = () => {
    const scale = Math.min(window.innerWidth / canvas.width, window.innerHeight / canvas.height);
    const s = scale >= 1 ? Math.floor(scale) : scale;
    canvas.style.width = `${canvas.width * s}px`;
    canvas.style.height = `${canvas.height * s}px`;
  };
  window.addEventListener('resize', fit);
  fit();

  return { canvas, ctx, width, height };
}

const NOOP = (): void => {};

/**
 * A drawing sink with correct dimensions and no pixels, for when there is
 * no document — Node.
 *
 * Sprite and tile modules bake their art at IMPORT time, so without this
 * the entire content layer is unimportable outside a browser: asking
 * "is this tile solid" or "does this entity overlap rock" meant booting a
 * page. Every size the simulation reads is declared data (spritefile
 * geometry, tile flags), never measured from pixels, so collision and
 * validation answer identically here; only the images are blank.
 *
 * Pixel read-backs get zeroes. That is right for the two callers who do it
 * (the CJK glyph fallback and the icon trimmer — both PRODUCE art), and it
 * is the reason not to derive a logic value from pixel content: headless,
 * it would silently be nothing.
 */
function headlessContext(canvas: { width: number; height: number }): CanvasRenderingContext2D {
  const real: Record<string, unknown> = {
    canvas,
    getImageData: (_x: number, _y: number, w: number, h: number) => ({
      data: new Uint8ClampedArray(Math.max(0, Math.trunc(w) * Math.trunc(h) * 4)),
      width: w,
      height: h,
    }),
    measureText: () => ({ width: 0 }),
    createPattern: () => null,
    createLinearGradient: () => ({ addColorStop: NOOP }),
    createRadialGradient: () => ({ addColorStop: NOOP }),
  };
  return new Proxy(real, {
    get: (t, p) => (p in t ? t[p as string] : NOOP),
    set: () => true,
  }) as unknown as CanvasRenderingContext2D;
}

/** Offscreen canvas helper (sprite baking, pattern tiles, layers). */
export function offscreen(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  if (typeof document === 'undefined') {
    const c: { width: number; height: number; getContext?: unknown } = { width: w, height: h };
    const ctx = headlessContext(c);
    c.getContext = () => ctx;
    return [c as unknown as HTMLCanvasElement, ctx];
  }
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}
