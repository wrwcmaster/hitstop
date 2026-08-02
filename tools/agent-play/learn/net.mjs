/**
 * A very small feed-forward network, by hand.
 *
 * No dependency, and none wanted: the whole point is that the trained
 * weights are a JSON blob the game can carry, and inference is a couple
 * of matrix multiplies that any runtime can do. The repo ships with zero
 * runtime dependencies and a learned policy should not be the thing that
 * changes that.
 *
 * ReLU hidden layers and an argmax output — no softmax, no sampling. A
 * deterministic pure function of (weights, observation), which is what a
 * policy has to be if it is ever going to drive something inside the sim
 * rather than just press keys at it.
 */
import { FEATURES, MOVES } from './features.mjs';

/** in -> hidden -> out. Small on purpose: fewer parameters, less to fit. */
export const SHAPE = [FEATURES, 24, MOVES.length];

export function paramCount(shape = SHAPE) {
  let n = 0;
  for (let l = 0; l + 1 < shape.length; l++) n += shape[l] * shape[l + 1] + shape[l + 1];
  return n;
}

/**
 * Forward pass. Returns the index of the chosen move.
 *
 * `scratch` lets a training loop run millions of these without handing
 * the garbage collector a new pair of arrays every frame.
 */
/** Raw output scores — the PPO collector samples from these; forward()
 * below argmaxes them, so the two cannot disagree about the network. */
export function forwardLogits(w, x, shape = SHAPE, scratch = {}) {
  let cur = x;
  let at = 0;
  for (let l = 0; l + 1 < shape.length; l++) {
    const inN = shape[l];
    const outN = shape[l + 1];
    const last = l + 2 === shape.length;
    scratch[l] ??= new Float64Array(outN);
    const next = scratch[l];
    for (let j = 0; j < outN; j++) {
      let sum = w[at + inN * outN + j];          // bias, stored after the matrix
      const base = j * inN;
      for (let i = 0; i < inN; i++) sum += w[at + base + i] * cur[i];
      // ReLU everywhere but the output, which is scored raw and argmaxed.
      next[j] = last ? sum : (sum > 0 ? sum : 0);
    }
    at += inN * outN + outN;
    cur = next;
  }
  return cur;
}

export function forward(w, x, shape = SHAPE, scratch = {}) {
  const out = forwardLogits(w, x, shape, scratch);
  let best = 0;
  for (let j = 1; j < out.length; j++) if (out[j] > out[best]) best = j;
  return best;
}

/** Deterministic PRNG, so a training run can be repeated exactly. */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Box-Muller, drawing from the same seeded stream. */
export function gauss(rand) {
  let u = 0;
  let v = 0;
  while (u === 0) u = rand();
  while (v === 0) v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
