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

/**
 * The GAMEPLAY random stream. Everything that affects the simulation
 * (drops, wave composition, AI rolls) draws from here via the helpers
 * below, so seeding it makes a whole run reproducible from an input tape.
 * Purely visual noise (camera shake, star fields, sfx pitch jitter) calls
 * `Math.random` directly and stays OUT of this stream — it runs per
 * wall-clock frame, and letting it consume seeded numbers would tie the
 * simulation to the frame rate and break replays.
 */
let random: () => number = Math.random;

/** Seed the gameplay stream (mulberry32). Recording/replay sets this at boot. */
export function seedRandom(seed: number): void {
  let a = seed >>> 0;
  random = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Random float in [lo, hi). */
export function rand(lo = 0, hi = 1): number {
  return lo + random() * (hi - lo);
}

/** Random integer in [lo, hi]. */
export function randInt(lo: number, hi: number): number {
  return lo + Math.floor(random() * (hi - lo + 1));
}

/** Random element of a non-empty array. */
export function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(random() * arr.length)];
}

/** Random chance: true with probability p. */
export function chance(p: number): boolean {
  return random() < p;
}

/** A quantity for display: whole numbers stay bare ("3"), fractions get
 * exactly one decimal ("1.5") — for damage numbers, HP/MP readouts, any
 * amount that might not land on a whole unit. */
export function formatAmount(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}
