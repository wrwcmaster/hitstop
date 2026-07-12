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
): PixelCanvas {
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;

  const fit = () => {
    const scale = Math.min(window.innerWidth / width, window.innerHeight / height);
    const s = scale >= 1 ? Math.floor(scale) : scale;
    canvas.style.width = `${width * s}px`;
    canvas.style.height = `${height * s}px`;
  };
  window.addEventListener('resize', fit);
  fit();

  return { canvas, ctx, width, height };
}

/** Offscreen canvas helper (sprite baking, pattern tiles, layers). */
export function offscreen(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}
