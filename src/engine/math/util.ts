/** Small math helpers used everywhere. Games are 90% lerps and clamps. */

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Frame-rate independent exponential smoothing.
 * Moves `a` toward `b`, covering `rate` fraction of the remaining distance
 * per second. Use this instead of `a += (b-a)*0.1` (which breaks at other
 * frame rates).
 */
export function damp(a: number, b: number, rate: number, dt: number): number {
  return lerp(a, b, 1 - Math.exp(-rate * dt));
}

/**
 * Frame-rate independent friction: returns the multiplier that scales a
 * velocity so that it retains `keep` fraction of itself after one second.
 * e.g. `v *= friction(0.001, dt)` -> velocity decays to 0.1% per second.
 */
export function friction(keep: number, dt: number): number {
  return Math.pow(keep, dt);
}

/** Move `a` toward `b` by at most `step` (linear, good for timers/speeds). */
export function approach(a: number, b: number, step: number): number {
  return a < b ? Math.min(a + step, b) : Math.max(a - step, b);
}

export function sign(v: number): number {
  return v > 0 ? 1 : v < 0 ? -1 : 0;
}

/** Random float in [lo, hi). */
export function rand(lo = 0, hi = 1): number {
  return lo + Math.random() * (hi - lo);
}

/** Random integer in [lo, hi]. */
export function randInt(lo: number, hi: number): number {
  return lo + Math.floor(Math.random() * (hi - lo + 1));
}

/** Random element of a non-empty array. */
export function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

/** Random chance: true with probability p. */
export function chance(p: number): boolean {
  return Math.random() < p;
}
