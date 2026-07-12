import { Loop } from '../core/loop';
import { Camera } from '../gfx/camera';
import { Particles, BurstOptions } from './particles';
import { Floaters } from './floaters';
import { Sfx } from '../audio/sfx';

/**
 * The Feel system — hitstop's reason to exist.
 *
 * One object that owns every "juice" primitive and, more importantly,
 * composes them into *impact presets*. Gameplay code says
 * `feel.impact(x, y, { strength: 0.8, dir: 1 })` and gets a coherent
 * bundle of hitstop + screenshake + camera kick + particles + flash + SFX
 * that scales together. Individual primitives stay available for custom
 * effects.
 *
 * Design rule: game feel parameters live in ONE place per effect, not
 * scattered through gameplay code. Tuning happens here.
 */
export interface ImpactOptions {
  /** 0..1 — how hard the hit should feel. Drives everything else. */
  strength?: number;
  /** Horizontal direction of the impact (-1 or 1), for kick + particle spray. */
  dir?: number;
  /** Particle colors. */
  colors?: string | string[];
  /** Extra particle count on top of the strength-derived amount. */
  particles?: number;
  /** Skip individual channels when a custom effect handles them. */
  noHitstop?: boolean;
  noShake?: boolean;
  /** Screen flash alpha (default: only on strong hits). */
  flash?: number;
  flashColor?: string;
  /** SFX id to play through the game's Sfx registry. */
  sfx?: string;
}

export class Feel {
  flashAlpha = 0;
  flashColor = '#ffffff';

  constructor(
    private loop: Loop,
    public camera: Camera,
    public particles: Particles,
    public floaters: Floaters,
    public sfx: Sfx,
  ) {}

  /* ---- primitives ---- */

  /** Freeze the whole simulation for `sec` seconds. */
  hitstop(sec: number): void {
    this.loop.freeze(sec);
  }

  /** Slow the simulation to `scale` speed for `sec` seconds. */
  slowmo(sec: number, scale = 0.35): void {
    this.loop.slow(sec, scale);
  }

  /** Full-screen color flash (rendered by Game after the scene). */
  flash(alpha: number, color = '#ffffff'): void {
    this.flashAlpha = Math.max(this.flashAlpha, alpha);
    this.flashColor = color;
  }

  shake(amount: number): void {
    this.camera.shake(amount);
  }

  kick(dx: number, dy: number): void {
    this.camera.kick(dx, dy);
  }

  burst(x: number, y: number, n: number, opts?: BurstOptions): void {
    this.particles.burst(x, y, n, opts);
  }

  text(x: number, y: number, str: string | number, color?: string, scale?: number): void {
    this.floaters.add(x, y, str, color, scale);
  }

  /* ---- composition ---- */

  /**
   * A complete, tuned impact. `strength` maps to:
   *   0.2 = light tick, 0.5 = solid sword hit, 0.8 = heavy blow, 1.0 = kill/explosion
   */
  impact(x: number, y: number, opts: ImpactOptions = {}): void {
    const s = opts.strength ?? 0.5;
    const dir = opts.dir ?? 0;

    if (!opts.noHitstop) this.hitstop(0.03 + s * 0.09);
    if (!opts.noShake) this.shake(0.08 + s * 0.45);
    if (dir !== 0) this.kick(dir * (1 + s * 4), -s * 2);

    const n = Math.round(4 + s * 12) + (opts.particles ?? 0);
    this.burst(x, y, n, {
      color: opts.colors ?? ['#f4f4f4', '#ffcd75'],
      speed: 80 + s * 110,
      life: 0.25 + s * 0.2,
      angle: dir !== 0 ? (dir > 0 ? 0 : Math.PI) : undefined,
      spread: dir !== 0 ? 1.8 : undefined,
      drag: 3,
    });

    const flashA = opts.flash ?? (s >= 0.9 ? 0.18 : 0);
    if (flashA > 0) this.flash(flashA, opts.flashColor);
    if (opts.sfx) this.sfx.play(opts.sfx);
  }

  /** Per-frame decay for real-time effects. Called by Game with real dt. */
  frame(realDt: number): void {
    this.flashAlpha = Math.max(0, this.flashAlpha - realDt * 3.5);
  }

  update(dt: number): void {
    this.particles.update(dt);
    this.floaters.update(dt);
  }

  /** World-space rendering (particles + floating text). */
  renderWorld(g: CanvasRenderingContext2D): void {
    this.particles.render(g);
    this.floaters.render(g);
  }

  /** Screen-space rendering (flash overlay). Called by Game last. */
  renderScreen(g: CanvasRenderingContext2D, w: number, h: number): void {
    if (this.flashAlpha > 0) {
      g.globalAlpha = Math.min(0.8, this.flashAlpha);
      g.fillStyle = this.flashColor;
      g.fillRect(0, 0, w, h);
      g.globalAlpha = 1;
    }
  }

  reset(): void {
    this.particles.clear();
    this.floaters.clear();
    this.flashAlpha = 0;
    this.camera.trauma = 0;
  }
}
