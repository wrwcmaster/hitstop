/**
 * The director: scripted sequences played over the LIVE world.
 *
 * A cutscene here is not a separate renderer or a video — it is the
 * running simulation with its inputs temporarily scripted: the same
 * actors, physics, camera, and feel systems, driven by a timeline
 * instead of a player. That is what keeps cutscenes deterministic (they
 * advance on the fixed timestep like everything else, so they record and
 * replay bit-for-bit) and what lets a co-op guest watch one for free
 * (the host simulates; the snapshots carry the motion).
 *
 * The engine owns the MECHANISM: steps, sequencing, easing, skip
 * semantics, and the letterbox state. The game owns the MEANING: what a
 * step does is a closure over game objects (pan the camera, walk the
 * knight via a scripted Input, show a banner), and cutscene content
 * lives in a game registry like every other definition.
 *
 * Skip semantics matter for determinism: skipping does not abort the
 * timeline, it FAST-FORWARDS it — every remaining step still enters,
 * lands on its final state, and exits, so a skipped cutscene leaves the
 * world in exactly the state a watched one does. A cutscene that sets a
 * flag or moves an actor can therefore never be cheated out of doing so.
 */
export interface DirectorStep<Ctx> {
  /** Seconds this step occupies. Omit (or 0) for an instant step. */
  duration?: number;
  /** Runs once when the step begins. */
  enter?(ctx: Ctx): void;
  /** Runs each frame with eased progress t in [0,1]. */
  update?(ctx: Ctx, t: number): void;
  /** Runs once when the step completes (also on skip). */
  exit?(ctx: Ctx): void;
  /** Easing for `update`'s t (default smoothstep). */
  ease?(t: number): number;
}

const smoothstep = (t: number): number => t * t * (3 - 2 * t);

/** Do nothing for a while — pacing is a step like any other. */
export function wait<Ctx>(seconds: number): DirectorStep<Ctx> {
  return { duration: seconds };
}

/** Run something once, instantly. */
export function call<Ctx>(fn: (ctx: Ctx) => void): DirectorStep<Ctx> {
  return { enter: fn };
}

/** Animate something over `seconds`; onUpdate receives eased t 0..1. */
export function tween<Ctx>(
  seconds: number,
  onUpdate: (ctx: Ctx, t: number) => void,
  ease?: (t: number) => number,
): DirectorStep<Ctx> {
  return { duration: seconds, update: onUpdate, ease };
}

/** Run steps simultaneously; the group lasts as long as its longest. */
export function together<Ctx>(...steps: DirectorStep<Ctx>[]): DirectorStep<Ctx> {
  const total = Math.max(0, ...steps.map((s) => s.duration ?? 0));
  return {
    duration: total,
    enter: (ctx) => steps.forEach((s) => s.enter?.(ctx)),
    update: (ctx, t) =>
      steps.forEach((s) => {
        const d = s.duration ?? 0;
        // Each child finishes on its own clock inside the group's span.
        const local = d <= 0 ? 1 : Math.min(1, (t * total) / d);
        s.update?.(ctx, (s.ease ?? smoothstep)(local));
      }),
    exit: (ctx) => steps.forEach((s) => s.exit?.(ctx)),
    // The group hands children pre-eased local time, so it must receive
    // raw time itself.
    ease: (t) => t,
  };
}

/** How fast the letterbox bars slide in/out, in fraction per second. */
const LETTERBOX_SPEED = 4;
/** Bar height as a fraction of the view (each bar). */
const LETTERBOX_DEPTH = 0.11;

export class Director<Ctx> {
  /** True while a sequence is playing — the scene's cue to hand over
   * input, stop following with the camera, and draw the letterbox. */
  active = false;
  /** Letterbox slide 0..1; animates in while active, out after. */
  private box = 0;

  private steps: DirectorStep<Ctx>[] = [];
  private index = 0;
  private t = 0;
  private ctx!: Ctx;
  private entered = false;
  private onDone: (() => void) | null = null;

  play(steps: DirectorStep<Ctx>[], ctx: Ctx, onDone?: () => void): void {
    // A new sequence while one is live fast-forwards the old one first,
    // so its state changes still land — never two half-played scripts.
    if (this.active) this.skip();
    this.steps = steps;
    this.ctx = ctx;
    this.index = 0;
    this.t = 0;
    this.entered = false;
    this.onDone = onDone ?? null;
    this.active = steps.length > 0;
  }

  /** Fast-forward everything left: enter, land on t=1, exit. */
  skip(): void {
    if (!this.active) return;
    while (this.index < this.steps.length) {
      const step = this.steps[this.index];
      if (!this.entered) step.enter?.(this.ctx);
      this.entered = false;
      step.update?.(this.ctx, 1);
      step.exit?.(this.ctx);
      this.index++;
    }
    this.finish();
  }

  private finish(): void {
    this.active = false;
    const done = this.onDone;
    this.onDone = null;
    done?.();
  }

  update(dt: number): void {
    // The letterbox animates on both edges of a sequence.
    const target = this.active ? 1 : 0;
    this.box += Math.sign(target - this.box) * Math.min(LETTERBOX_SPEED * dt, Math.abs(target - this.box));

    if (!this.active) return;
    let budget = dt;
    // A frame may cross several instant/short steps; spend it fully so
    // zero-duration steps never cost a frame each (determinism aside,
    // thirty `call`s should not take half a second).
    while (this.active && budget >= 0) {
      const step = this.steps[this.index];
      if (!step) {
        this.finish();
        return;
      }
      if (!this.entered) {
        this.entered = true;
        this.t = 0;
        step.enter?.(this.ctx);
      }
      const d = step.duration ?? 0;
      if (d <= 0) {
        step.update?.(this.ctx, 1);
        step.exit?.(this.ctx);
        this.entered = false;
        this.index++;
        continue; // costs no time
      }
      this.t += budget;
      if (this.t < d) {
        step.update?.(this.ctx, (step.ease ?? smoothstep)(this.t / d));
        return;
      }
      // Step finished inside this frame; carry the remainder onward.
      budget = this.t - d;
      step.update?.(this.ctx, 1);
      step.exit?.(this.ctx);
      this.entered = false;
      this.index++;
      if (budget === 0) return;
    }
  }

  /** Cinematic bars, drawn by the scene over the world (screen space).
   * Visible whenever sliding, so the exit animation still shows. */
  renderLetterbox(g: CanvasRenderingContext2D, width: number, height: number): void {
    if (this.box <= 0) return;
    const h = Math.round(height * LETTERBOX_DEPTH * this.box);
    g.fillStyle = '#000';
    g.fillRect(0, 0, width, h);
    g.fillRect(0, height - h, width, h);
  }

  /** Drop everything without running it — scene teardown only. Content
   * must prefer skip(), which keeps the world consistent. */
  stop(): void {
    this.steps = [];
    this.active = false;
    this.entered = false;
    this.onDone = null;
  }
}
