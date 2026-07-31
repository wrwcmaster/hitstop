/**
 * The trained policy, in the shape `arena-trial.mjs` expects.
 *
 *   node tools/agent-play/arena-trial.mjs --policy ./learn/learned.mjs
 *
 * Nothing here decides anything: every threshold that the hand-written
 * policy argued about — how much air to keep, when a swing is safe, how
 * long to back off — is a weight in `weights.json` now, found by playing
 * rather than by taste. This file only loads them and runs the forward
 * pass.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { actor } from './rollout.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const file = path.join(here, 'weights.json');

if (!fs.existsSync(file)) {
  throw new Error(`no trained weights at ${file} — run: node tools/agent-play/learn/train.mjs`);
}
const blob = JSON.parse(fs.readFileSync(file, 'utf8'));
const act = actor(Float64Array.from(blob.weights), blob.shape);

export const meta = {
  shape: blob.shape, generation: blob.generation,
  fitness: blob.fitness, trainSeeds: blob.trainSeeds,
};

export function decide(o) {
  return act(o);
}

/** No memory to clear — the net is a pure function of the observation. */
export function reset() {}
