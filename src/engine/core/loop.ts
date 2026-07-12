/**
 * Fixed-timestep game loop.
 *
 * Simulation always advances in exact `STEP` increments (deterministic
 * physics, stable feel tuning) while rendering runs once per animation
 * frame. Time manipulation — hitstop and slow motion, the heart of combat
 * feedback — is implemented HERE, at the loop level, so a frozen frame
 * freezes everything (entities, particles, camera) with zero cooperation
 * needed from gameplay code.
 */
export const STEP = 1 / 60;

/** Max simulation steps per render frame before we drop time (spiral-of-death guard). */
const MAX_STEPS = 5;

export interface LoopHooks {
  /** Fixed-timestep simulation update. dt is always STEP. */
  update(dt: number): void;
  /** Render. Runs every animation frame regardless of time scale. */
  render(): void;
  /**
   * Runs every animation frame with real (unscaled, unfrozen) time.
   * Use for things that must keep moving during hitstop: screen flash
   * decay, "press any key" blinking, debug UI.
   */
  frame?(realDt: number): void;
}

export class Loop {
  /** Seconds of freeze remaining (hitstop). */
  private freezeT = 0;
  /** Seconds of slow motion remaining, and its time scale. */
  private slowT = 0;
  private slowScale = 0.35;

  private acc = 0;
  private last = 0;
  private running = false;
  private raf = 0;

  constructor(private hooks: LoopHooks) {}

  /** Freeze the entire simulation for `sec` (does not stack; takes the max). */
  freeze(sec: number): void {
    this.freezeT = Math.max(this.freezeT, sec);
  }

  /** Run the simulation at `scale` speed for `sec`. */
  slow(sec: number, scale = 0.35): void {
    this.slowT = Math.max(this.slowT, sec);
    this.slowScale = scale;
  }

  /** Current effective time scale (0 while frozen). Handy for debug UI. */
  get timeScale(): number {
    if (this.freezeT > 0) return 0;
    return this.slowT > 0 ? this.slowScale : 1;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    const tick = (now: number) => {
      if (!this.running) return;
      this.raf = requestAnimationFrame(tick);
      const realDt = Math.min(0.1, (now - this.last) / 1000);
      this.last = now;

      this.hooks.frame?.(realDt);

      if (this.freezeT > 0) {
        this.freezeT -= realDt;
      } else {
        let scale = 1;
        if (this.slowT > 0) {
          scale = this.slowScale;
          this.slowT -= realDt;
        }
        this.acc += realDt * scale;
        let n = 0;
        while (this.acc >= STEP && n++ < MAX_STEPS) {
          this.hooks.update(STEP);
          this.acc -= STEP;
        }
        if (this.acc > STEP * MAX_STEPS) this.acc = 0;
      }

      this.hooks.render();
    };
    this.raf = requestAnimationFrame(tick);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }
}
