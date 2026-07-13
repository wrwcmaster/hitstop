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

/** Offscreen canvas helper (sprite baking, pattern tiles, layers). */
export function offscreen(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}
