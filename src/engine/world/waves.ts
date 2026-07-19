/**
 * Wave combat as a reusable mechanism: a queue of things to spawn,
 * telegraphed appearances, clear detection, a breather, then the next
 * wave — or a goal that ends the gauntlet.
 *
 * The runner owns TIMING and SEQUENCING only. What a wave contains, where
 * things appear, what spawning means, what counts as alive, and every
 * banner/sound/reward is the game's, supplied through the config. Specs
 * are opaque to the runner (hitstop uses monster-type strings; anything
 * serializable works).
 *
 * Determinism note: the runner draws no randomness itself; `place` is the
 * game's chance to roll positions, and it's called exactly once per spawn
 * tick, so recorded runs replay bit-for-bit across the refactor seam.
 */

/** A queued spec currently telegraphing in at (x, y). */
export interface Telegraph<S> {
  /** Seconds until it materializes. */
  t: number;
  x: number;
  y: number;
  spec: S;
}

export interface WaveRunnerConfig<S> {
  /** The specs wave `n` should spawn (append order = spawn order). */
  compose(wave: number): S[];
  /** Where the next spec appears (roll randomness here). */
  place(spec: S): { x: number; y: number };
  /** Materialize a telegraphed spec into the world. */
  spawn(spec: S, x: number, y: number): void;
  /** Anything from this wave still alive? */
  alive(): boolean;
  /** Gate for progressing after a clear (e.g. the player must be alive). */
  canProgress(): boolean;
  /** Pacing knobs, read live so per-room tables can vary them. */
  timing(): { spawnInterval: number; telegraphTime: number; clearDelay: number };
  /** The wave that ends the gauntlet (undefined = endless). */
  goal(): number | undefined;
  /** A wave was announced / cleared / the goal wave was cleared. `onGoal`
   * may fire on every post-goal breather — guard once-only effects. */
  onWave?(wave: number): void;
  onClear?(wave: number): void;
  onGoal?(wave: number): void;
}

export class WaveRunner<S> {
  wave = 0;
  private queue: S[] = [];
  private pending: Telegraph<S>[] = [];
  private spawnT = 0;
  private clearT = 0;
  private clearShown = false;

  constructor(private config: WaveRunnerConfig<S>) {}

  /** Specs still queued to spawn this wave. */
  get queued(): number {
    return this.queue.length;
  }

  /** Telegraphs currently blinking in (also renderable via `telegraphs`). */
  get telegraphs(): readonly Telegraph<S>[] {
    return this.pending;
  }

  /** Forget everything (entering a room). */
  reset(): void {
    this.wave = 0;
    this.queue = [];
    this.pending = [];
    this.spawnT = 0;
    this.clearT = 0;
    this.clearShown = false;
  }

  /** Arm the waves. Pass `fromWave` to resume a checkpoint mid-gauntlet
   * (the saved wave restarts fresh); omit for a new run. */
  begin(fromWave = 1): void {
    this.wave = Math.max(0, fromWave - 1);
    this.nextWave();
  }

  private nextWave(): void {
    this.wave++;
    this.clearShown = false;
    this.queue.push(...this.config.compose(this.wave));
    this.config.onWave?.(this.wave);
  }

  update(dt: number): void {
    // Feed the telegraph queue.
    this.spawnT -= dt;
    if (this.queue.length && this.spawnT <= 0) {
      this.spawnT = this.config.timing().spawnInterval;
      const spec = this.queue.shift()!;
      const { x, y } = this.config.place(spec);
      this.pending.push({ t: this.config.timing().telegraphTime, x, y, spec });
    }

    // Telegraphs mature into the world.
    for (let i = this.pending.length - 1; i >= 0; i--) {
      const s = this.pending[i];
      s.t -= dt;
      if (s.t <= 0) {
        this.config.spawn(s.spec, s.x, s.y);
        this.pending.splice(i, 1);
      }
    }

    // Wave cleared → breather → next wave (or the goal ends the gauntlet).
    if (!this.queue.length && !this.pending.length && !this.config.alive() && this.config.canProgress()) {
      if (!this.clearShown) {
        this.clearShown = true;
        this.config.onClear?.(this.wave);
      }
      this.clearT += dt;
      if (this.clearT >= this.config.timing().clearDelay) {
        this.clearT = 0;
        const goal = this.config.goal();
        if (goal && this.wave >= goal) this.config.onGoal?.(this.wave);
        else this.nextWave();
      }
    }
  }
}
