/**
 * Train a policy for the arena by evolution strategies.
 *
 *   node tools/agent-play/learn/train.mjs                 # defaults
 *   node tools/agent-play/learn/train.mjs --gens 60 --pop 24
 *   node tools/agent-play/learn/train.mjs --resume        # continue from weights.json
 *
 * WHY ES AND NOT GRADIENTS. The sim is a black box with hit-stop, state
 * machines and discrete events in it; there is nothing to differentiate
 * through without rewriting the game. ES only needs to be able to PLAY,
 * which this sim does at 7,500 frames/s in-process — an HTTP gym wrapper
 * would cap at ~70 turns/s and throw away two orders of magnitude.
 *
 * WHY NOT A LIBRARY. The repo ships zero runtime dependencies, and the
 * artifact here is a JSON blob of weights plus two matrix multiplies.
 * Adding torch to produce 1,700 numbers would be a poor trade.
 *
 * SEEDS ARE HELD OUT. Training rotates through a POOL of seeds; the
 * that matters comes from `arena-trial.mjs` on seeds this never saw.
 * Fitting five seeds and believing the number is exactly the mistake the
 * hand-written policy made all day, and a learner overfits far harder.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bootGame, close } from '../headless.mjs';
import { paramCount, rng, gauss, SHAPE } from './net.mjs';
import { episode, actor, EPISODE } from './rollout.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(here, 'weights.json');

const arg = (n, d) => {
  const i = process.argv.indexOf(n);
  return i >= 0 ? process.argv[i + 1] : d;
};
const GENS = Number(arg('--gens', 40));
const POP = Number(arg('--pop', 20));          // must be even: antithetic pairs
const SIGMA = Number(arg('--sigma', 0.08));    // exploration noise
const LR = Number(arg('--lr', 0.06));
// A POOL, not a fixed pair. Each generation draws from it; over a run the
// policy meets all of them. Two fixed seeds trained to zero deaths and
// then died on all ten held-out seeds — it had learned those two arenas,
// not the game. Rotating costs nothing per generation (the cost is
// candidates x seeds-per-generation, which is unchanged) and is the
// difference between memorising and generalising.
const POOL = arg('--seeds', '3,11,29,47,58,64,91,102').split(',').map(Number);
const PER_GEN = Number(arg('--seeds-per-gen', 2));
const resume = process.argv.includes('--resume');

const N = paramCount();
const rand = rng(Number(arg('--rng', 12345)));

let mu = new Float64Array(N);
if (resume && fs.existsSync(OUT)) {
  mu = Float64Array.from(JSON.parse(fs.readFileSync(OUT, 'utf8')).weights);
  console.log('resumed from', OUT);
} else {
  // Small random init. Zeros would make every output identical and every
  // perturbation equally meaningless for the first few generations.
  for (let i = 0; i < N; i++) mu[i] = gauss(rand) * 0.1;
}

console.log(`policy ${SHAPE.join('-')} = ${N} parameters`);
console.log(`ES: ${GENS} generations x ${POP} candidates x ${PER_GEN} seeds`
  + `, ${EPISODE} frames each`);
console.log(`seed pool ${POOL.join(',')}, ${PER_GEN} per generation — others are the score
`);

/** Rank-normalise to [-0.5, 0.5]: robust to reward outliers. */
function ranked(vals) {
  const order = vals.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]);
  const out = new Array(vals.length);
  order.forEach(([, i], r) => { out[i] = r / (vals.length - 1) - 0.5; });
  return out;
}

const t0 = Date.now();
let best = { fitness: -Infinity, weights: null };

for (let g = 1; g <= GENS; g++) {
  // Antithetic pairs: every perturbation is tried in both directions, so
  // the difference isolates the direction from the noise.
  const eps = [];
  for (let k = 0; k < POP / 2; k++) {
    const e = new Float64Array(N);
    for (let i = 0; i < N; i++) e[i] = gauss(rand);
    eps.push(e, null);          // placeholder; the mirror shares the array
  }

  // This generation's seeds, walking the pool so every one gets used.
  const TRAIN_SEEDS = Array.from({ length: PER_GEN },
    (_, k) => POOL[((g - 1) * PER_GEN + k) % POOL.length]);
  const fitness = new Array(POP).fill(0);
  // Accumulated across seeds, not just the last one: a candidate that
  // cleared two waves on seed 3 and died instantly on seed 11 should not
  // be reported as whichever happened to run second.
  const stats = Array.from({ length: POP }, () => ({ waves: 0, hits: 0, score: 0, died: 0 }));

  // One boot per seed, all candidates evaluated on it: booting is the
  // expensive part, an episode is a quarter second.
  for (const seed of TRAIN_SEEDS) {
    const { harness, game } = await bootGame({ fresh: true, seed });
    for (let c = 0; c < POP; c++) {
      const pair = Math.floor(c / 2);
      const sign = c % 2 === 0 ? 1 : -1;
      const e = eps[pair * 2];
      const w = new Float64Array(N);
      for (let i = 0; i < N; i++) w[i] = mu[i] + sign * SIGMA * e[i];
      const r = episode(harness, game, actor(w));
      fitness[c] += r.fitness / TRAIN_SEEDS.length;
      const acc = stats[c];
      acc.waves += r.waves; acc.hits += r.hits; acc.score += r.score; acc.died += r.died ? 1 : 0;
    }
    await close();
  }

  // ES update: step along the noise, weighted by how well it did.
  const adv = ranked(fitness);
  const step = new Float64Array(N);
  for (let c = 0; c < POP; c++) {
    const e = eps[Math.floor(c / 2) * 2];
    const sign = c % 2 === 0 ? 1 : -1;
    const a = adv[c];
    for (let i = 0; i < N; i++) step[i] += a * sign * e[i];
  }
  for (let i = 0; i < N; i++) mu[i] += (LR / (POP * SIGMA)) * step[i];

  const top = fitness.indexOf(Math.max(...fitness));
  if (fitness[top] > best.fitness) {
    best = { fitness: fitness[top], weights: Array.from(mu) };
    fs.writeFileSync(OUT, JSON.stringify({
      shape: SHAPE, note: 'ES-trained arena policy', trainSeeds: POOL,
      generation: g, fitness: Math.round(fitness[top]), weights: best.weights,
    }));
  }
  const s = stats[top];
  const mean = fitness.reduce((a, b) => a + b, 0) / POP;
  console.log(`gen ${String(g).padStart(3)}  best ${String(Math.round(fitness[top])).padStart(6)}`
    + `  mean ${String(Math.round(mean)).padStart(6)}`
    + `  | totals over ${TRAIN_SEEDS.length} seeds: waves ${s.waves} hits ${s.hits}`
    + ` kills ${s.score} deaths ${s.died}`
    + `  seeds ${TRAIN_SEEDS.join('/')}  ${((Date.now() - t0) / 1000).toFixed(0)}s`);
}

console.log(`\nwrote ${OUT}`);
console.log('score it on unseen seeds:');
console.log('  node tools/agent-play/arena-trial.mjs --policy ./learn/learned.mjs'
  + ' --seeds 1,7,42,99,2024,5,13,77,300,808');
process.exit(0);
