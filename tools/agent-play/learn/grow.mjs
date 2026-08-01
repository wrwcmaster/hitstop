/**
 * Widen a trained net's input layer without changing what it does.
 *
 *   node tools/agent-play/learn/grow.mjs
 *
 * Adding goal slots to the observation changes the input width, which
 * would ordinarily throw away every hour of training. It does not have
 * to: give the new inputs weights of exactly zero and the network
 * computes precisely what it computed before, because those inputs
 * contribute nothing until training gives them a reason to.
 *
 * So the arena policy keeps its fighting and starts goal-conditioning
 * from competence rather than from noise. That matters more than it
 * sounds — evolution strategies improve by nudging what already works,
 * and a random restart on a harder task is how you get a policy that
 * learns to stand in a corner.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SHAPE, paramCount } from './net.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const file = path.join(here, 'weights.json');
const blob = JSON.parse(fs.readFileSync(file, 'utf8'));
const from = blob.shape;
const to = SHAPE;

if (from[0] === to[0]) {
  console.log(`already ${from.join('-')} — nothing to do`);
  process.exit(0);
}
if (from.length !== to.length || from.slice(1).join() !== to.slice(1).join()) {
  throw new Error(`can only widen the INPUT: ${from.join('-')} -> ${to.join('-')}`);
}

const old = blob.weights;
const grown = new Array(paramCount(to)).fill(0);
let a = 0;   // read cursor, old layout
let b = 0;   // write cursor, new layout
for (let l = 0; l + 1 < to.length; l++) {
  const inOld = from[l];
  const inNew = to[l];
  const out = to[l + 1];
  for (let j = 0; j < out; j++) {
    // Copy this output's existing weights; the extra inputs stay zero.
    for (let i = 0; i < inOld; i++) grown[b + j * inNew + i] = old[a + j * inOld + i];
  }
  // Biases carry over untouched.
  for (let j = 0; j < out; j++) grown[b + inNew * out + j] = old[a + inOld * out + j];
  a += inOld * out + out;
  b += inNew * out + out;
}

fs.writeFileSync(file, JSON.stringify({
  ...blob, shape: to, weights: grown,
  note: `${blob.note ?? 'policy'} (grown ${from.join('-')} -> ${to.join('-')}, new inputs zeroed)`,
}));
console.log(`${from.join('-')} (${old.length} params) -> ${to.join('-')} (${grown.length} params)`);
console.log('new input weights are zero, so behaviour is unchanged until trained');
