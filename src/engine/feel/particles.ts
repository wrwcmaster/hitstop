import { pick, rand } from '../math/util';

/**
 * Rectangle-pixel particle system. Particles shrink over their lifetime,
 * support gravity and drag, and render as filled rects (this is pixel
 * art — square particles look right).
 */
interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  t: number;
  size: number;
  color: string;
  grav: number;
  drag: number;
}

export interface BurstOptions {
  /** Base direction in radians. Omit for full-circle spray. */
  angle?: number;
  /** Random spread around angle in radians (default: full circle). */
  spread?: number;
  /** Base speed in px/s (randomized 0.4x–1.3x). */
  speed?: number;
  /** Base lifetime in seconds (randomized 0.6x–1.4x). */
  life?: number;
  size?: number;
  /** A color or a set to pick from per-particle. */
  color?: string | string[];
  grav?: number;
  drag?: number;
}

export class Particles {
  private parts: Particle[] = [];

  get count(): number {
    return this.parts.length;
  }

  spawn(p: Partial<Particle>): void {
    this.parts.push({
      x: 0, y: 0, vx: 0, vy: 0, life: 0.4, t: 0, size: 2,
      color: '#fff', grav: 0, drag: 2,
      ...p,
    });
  }

  /** Spray `n` particles from a point. The workhorse of combat feedback. */
  burst(x: number, y: number, n: number, opts: BurstOptions = {}): void {
    for (let i = 0; i < n; i++) {
      const a =
        (opts.angle !== undefined ? opts.angle : rand(0, Math.PI * 2)) +
        rand(-0.5, 0.5) * (opts.spread !== undefined ? opts.spread : Math.PI * 2);
      const sp = (opts.speed ?? 90) * rand(0.4, 1.3);
      this.spawn({
        x, y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        life: (opts.life ?? 0.4) * rand(0.6, 1.4),
        size: opts.size ?? 2,
        color: Array.isArray(opts.color) ? pick(opts.color) : (opts.color ?? '#fff'),
        grav: opts.grav ?? 0,
        drag: opts.drag ?? 2,
      });
    }
  }

  update(dt: number): void {
    for (let i = this.parts.length - 1; i >= 0; i--) {
      const p = this.parts[i];
      p.t += dt;
      if (p.t >= p.life) {
        this.parts.splice(i, 1);
        continue;
      }
      p.vy += p.grav * dt;
      const f = Math.pow(0.5, dt * p.drag);
      p.vx *= f;
      p.vy *= f;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
  }

  render(g: CanvasRenderingContext2D): void {
    for (const p of this.parts) {
      const k = 1 - p.t / p.life;
      const s = Math.max(1, Math.round(p.size * k));
      g.fillStyle = p.color;
      g.fillRect(Math.round(p.x - s / 2), Math.round(p.y - s / 2), s, s);
    }
  }

  clear(): void {
    this.parts.length = 0;
  }
}
