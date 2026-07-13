import { clamp, damp, friction } from '../math/util';

/**
 * Camera with built-in feel:
 *
 * - Smooth follow with velocity lookahead (the camera leads the player).
 * - Trauma-based screenshake: hits add trauma; shake magnitude is
 *   trauma², so small hits barely wiggle while big ones slam. Trauma
 *   decays linearly. (The classic Vlambeer / Squirrel Eiserloh model.)
 * - Directional kick: an impulse offset that springs back — this is what
 *   sells the *direction* of an impact.
 */
export class Camera {
  x = 0;
  y = 0;
  trauma = 0;
  private kx = 0;
  private ky = 0;

  /**
   * World zoom: how much larger than 1:1 the world renders. At 2, the
   * camera shows a half-size window of the world (characters appear
   * twice as big) while screen-space UI is unaffected. viewW/viewH
   * shrink accordingly. Shake/kick offsets are normalized by zoom so
   * feel tuning stays in *screen* pixels.
   */
  zoom = 1;

  /** World bounds the view is clamped to. */
  minX = 0;
  minY = -Infinity;
  maxX = Infinity;
  maxY = Infinity;

  /** Follow smoothing rate (higher = snappier). */
  followRate = 7;
  /** Max shake offset in pixels at full trauma. */
  shakeAmp = 7;
  /** Trauma decay per second. */
  traumaDecay = 1.6;
  /**
   * Render offset quantization in logical pixels. 1 on a 1× canvas;
   * 1/zoom on zoomed canvases so scrolling lands on device pixels
   * (half-pixel camera = visibly smoother pans at 2×).
   */
  snap = 1;

  /** Visible world width/height (screen size ÷ zoom). */
  viewW: number;
  viewH: number;
  private baseW: number;
  private baseH: number;

  constructor(viewW: number, viewH: number) {
    this.viewW = this.baseW = viewW;
    this.viewH = this.baseH = viewH;
  }

  /** Set the world zoom (see `zoom`). */
  setZoom(z: number): void {
    this.zoom = z;
    this.viewW = this.baseW / z;
    this.viewH = this.baseH / z;
  }

  setBounds(minX: number, minY: number, maxX: number, maxY: number): void {
    this.minX = minX;
    this.minY = minY;
    this.maxX = maxX;
    this.maxY = maxY;
  }

  /** Smoothly track a world-space target (already including any lookahead). */
  follow(tx: number, ty: number, dt: number): void {
    this.x = damp(this.x, tx, this.followRate, dt);
    this.y = damp(this.y, ty, this.followRate, dt);
    this.x = clamp(this.x, this.minX, Math.max(this.minX, this.maxX - this.viewW));
    this.y = clamp(this.y, this.minY, Math.max(this.minY, this.maxY - this.viewH));
    this.trauma = Math.max(0, this.trauma - dt * this.traumaDecay);
    const f = friction(0.001, dt);
    this.kx *= f;
    this.ky *= f;
  }

  /** Add screenshake trauma (0..1 scale; stacks, clamped at 1). */
  shake(amount: number): void {
    this.trauma = Math.min(1, this.trauma + amount);
  }

  /** Directional impulse — kick the camera away from an impact. */
  kick(dx: number, dy: number): void {
    this.kx += dx;
    this.ky += dy;
  }

  /** Final render offsets, including shake noise and kick — normalized
   * by zoom so tuned magnitudes read as SCREEN pixels at any zoom. */
  offsetX(): number {
    const t = this.trauma * this.trauma;
    return ((Math.random() * 2 - 1) * this.shakeAmp * t + this.kx) / this.zoom;
  }

  offsetY(): number {
    const t = this.trauma * this.trauma;
    return ((Math.random() * 2 - 1) * this.shakeAmp * 0.7 * t + this.ky) / this.zoom;
  }

  /** Apply the camera transform for world-space drawing. */
  begin(g: CanvasRenderingContext2D): void {
    g.save();
    g.scale(this.zoom, this.zoom);
    const q = (v: number) => Math.round(v / this.snap) * this.snap;
    g.translate(q(-this.x + this.offsetX()), q(-this.y + this.offsetY()));
  }

  end(g: CanvasRenderingContext2D): void {
    g.restore();
  }
}
