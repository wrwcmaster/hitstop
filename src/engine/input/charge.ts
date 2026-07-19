/**
 * Hold-to-charge: the gesture behind drawn bows, charged slashes, and
 * held-shot spells. Tracks how long a button has been held and maps it
 * to a POWER value the game spends however it likes (muzzle speed,
 * damage, radius...).
 *
 * The mapping: power ramps from `floor` (an instant tap) to 1 (a hold of
 * `time` seconds), shaped by `curve` — >1 back-loads the ramp so the
 * last moments of a draw matter most; <1 front-loads it. `full` flips
 * true exactly once per charge crossing the top, which is the game's cue
 * for the "fully drawn" click (sfx, flash, particle).
 *
 * Like everything feel-adjacent it runs on fixed-step dt, so charged
 * shots recorded in a replay reproduce exactly.
 */
export interface ChargeParams {
  /** Seconds of hold to reach full power. */
  time: number;
  /** Power of an instant tap, as a fraction of full (0..1). */
  floor: number;
  /** Ramp shape exponent (default 1 = linear). */
  curve?: number;
}

export class Charge {
  private t = 0;
  private wasFull = false;

  constructor(private params: ChargeParams) {}

  /** Start a fresh charge (entering the draw state). */
  begin(params?: ChargeParams): void {
    if (params) this.params = params;
    this.t = 0;
    this.wasFull = false;
  }

  /** Advance the hold. Returns true exactly when the charge tops out —
   * the moment to play the "fully drawn" cue. */
  update(dt: number): boolean {
    this.t += dt;
    const nowFull = this.progress >= 1;
    const justFull = nowFull && !this.wasFull;
    this.wasFull = nowFull;
    return justFull;
  }

  /** Raw hold completion, 0..1 (drives meters and draw poses). */
  get progress(): number {
    return Math.min(1, this.t / this.params.time);
  }

  /** Charge held to the top. */
  get full(): boolean {
    return this.progress >= 1;
  }

  /** The payoff: floor..1, shaped by the curve. Multiply your speed /
   * damage / radius by this. */
  get power(): number {
    const { floor, curve = 1 } = this.params;
    return floor + (1 - floor) * Math.pow(this.progress, curve);
  }
}
