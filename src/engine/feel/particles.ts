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
  /** Color over lifetime (start → end); overrides `color` when set. */
  ramp?: string[];
  /** 'pixel' (default) shrinks a square; 'ring' is an expanding shockwave. */
  shape?: 'pixel' | 'ring';
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

/**
 * One burst within a composed effect. Delayed emitters make staged
 * detonations (flash, then debris, then smoke) from a single call.
 */
export interface EffectEmitter extends BurstOptions {
  count: number;
  /** Seconds after the effect starts before this emitter fires. */
  delay?: number;
  /** Color over each particle's lifetime (start → end). */
  ramp?: string[];
  shape?: 'pixel' | 'ring';
}

export interface EffectDef {
  emitters: EffectEmitter[];
}

/** An emitter waiting out its delay. */
interface PendingEmitter {
  t: number;
  x: number;
  y: number;
  emitter: EffectEmitter;
  scale: number;
}

export class Particles {
  private parts: Particle[] = [];
  private pending: PendingEmitter[] = [];

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

  /** Play a composed effect at a point. `scale` sizes the whole thing. */
  playEffect(x: number, y: number, def: EffectDef, scale = 1): void {
    for (const em of def.emitters) {
      if (em.delay) this.pending.push({ t: em.delay, x, y, emitter: em, scale });
      else this.emit(x, y, em, scale);
    }
  }

  private emit(x: number, y: number, em: EffectEmitter, scale: number): void {
    const n = Math.max(1, Math.round(em.count * scale));
    for (let i = 0; i < n; i++) {
      const a =
        (em.angle !== undefined ? em.angle : rand(0, Math.PI * 2)) +
        rand(-0.5, 0.5) * (em.spread !== undefined ? em.spread : Math.PI * 2);
      const sp = (em.speed ?? 90) * scale * rand(0.4, 1.3);
      this.spawn({
        x, y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        life: (em.life ?? 0.4) * rand(0.6, 1.4),
        size: (em.size ?? 2) * scale,
        color: Array.isArray(em.color) ? pick(em.color) : (em.color ?? '#fff'),
        ramp: em.ramp,
        shape: em.shape,
        grav: em.grav ?? 0,
        drag: em.drag ?? 2,
      });
    }
  }

  update(dt: number): void {
    for (let i = this.pending.length - 1; i >= 0; i--) {
      const p = this.pending[i];
      p.t -= dt;
      if (p.t <= 0) {
        this.emit(p.x, p.y, p.emitter, p.scale);
        this.pending.splice(i, 1);
      }
    }
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
    // Quarter-pixel granularity: on a zoomed canvas the smallest spark is
    // a single device pixel, so embers shrink all the way down as they die.
    const q = (v: number) => Math.round(v * 4) / 4;
    for (const p of this.parts) {
      const a = p.t / p.life; // age 0→1
      const k = 1 - a;
      if (p.shape === 'ring') {
        // Shockwave: radius eases out to `size`, stroke thins and fades.
        const r = p.size * (1 - k * k);
        g.save();
        g.globalAlpha = k;
        g.strokeStyle = p.color;
        g.lineWidth = Math.max(0.5, 2 * k);
        g.beginPath();
        g.arc(q(p.x), q(p.y), Math.max(0.5, r), 0, Math.PI * 2);
        g.stroke();
        g.restore();
        continue;
      }
      const s = Math.max(0.25, q(p.size * k));
      g.fillStyle = p.ramp
        ? p.ramp[Math.min(p.ramp.length - 1, Math.floor(a * p.ramp.length))]
        : p.color;
      g.fillRect(q(p.x - s / 2), q(p.y - s / 2), s, s);
    }
  }

  clear(): void {
    this.parts.length = 0;
  }
}
