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

  constructor(
    public viewW: number,
    public viewH: number,
  ) {}

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

  /** Final render offsets, including shake noise and kick. */
  offsetX(): number {
    const t = this.trauma * this.trauma;
    return (Math.random() * 2 - 1) * this.shakeAmp * t + this.kx;
  }

  offsetY(): number {
    const t = this.trauma * this.trauma;
    return (Math.random() * 2 - 1) * this.shakeAmp * 0.7 * t + this.ky;
  }

  /** Apply the camera transform for world-space drawing. */
  begin(g: CanvasRenderingContext2D): void {
    g.save();
    g.translate(Math.round(-this.x + this.offsetX()), Math.round(-this.y + this.offsetY()));
  }

  end(g: CanvasRenderingContext2D): void {
    g.restore();
  }
}
