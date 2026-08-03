/**
 * On-policy trajectory collector: the Node half of the PPO loop.
 *
 *   node tools/agent-play/learn/collect.mjs --weights w.json --out traj.jsonl \
 *        --episodes 8 --room throne [--det] [--temp 1.0]
 *
 * The split: this side owns the SIM (7,500 frames/s in-process, which an
 * env server would throw away); the Python side (ppo.py) owns the maths.
 * Weights come in as the same JSON blob net.mjs runs; trajectories go
 * out as JSONL, one step per line: {o, a, lp, r, d} — observation
 * vector, action index, log-prob under the sampling policy, per-step
 * reward, done flag. Per-STEP reward is the whole point of the exercise:
 * ES's one-scalar-per-episode could not see "struck without being
 * touched" inside a 2,500-frame fight, and this file is where that
 * signal finally gets a timestamp.
 *
 * The reward is the SAME quantities as rollout.mjs's REWARD, paid when
 * they happen instead of summed at the end — kills when score moves,
 * hits when hp drops, waves when the event fires, terminal bonuses at
 * the boundary. Numbers identical, timing honest.
 */
import fs from 'node:fs';
import { bootGame, close } from '../headless.mjs';
import { encode, MOVES, FEATURES } from './features.mjs';
import { forwardLogits } from './net.mjs';
import { REWARD, EPISODE } from './rollout.mjs';

const arg = (n, d) => {
  const i = process.argv.indexOf(n);
  return i >= 0 ? process.argv[i + 1] : d;
};
const weightsPath = arg('--weights', 'tools/agent-play/learn/weights.json');
const outPath = arg('--out', 'tools/agent-play/learn/traj.jsonl');
const EPISODES = Number(arg('--episodes', 8));
const ROOM = arg('--room', 'throne');
const DET = process.argv.includes('--det');
// temp 0 means argmax. Validation historically argmaxed (--det implied
// it); now --det --temp 0.5 judges the DICE instead — reproducibly,
// because det seeds the sampler from the episode seed.
const TEMP = Number(arg('--temp', DET ? 0 : 1));
// Random spawn for training episodes. Every fixed-spawn episode starts
// her at the same wall-adjacent spot, so all experience begins where
// cornering is the natural policy and the corner basin deepens with
// every iteration — the policy literally never collects data on what
// mid-room play earns. Validation keeps the fixed spawn (--det), so
// scores stay comparable across every run ever made.
const RAND_SPAWN = process.argv.includes('--rand-spawn');
const SEEDS = arg('--seeds', '3,11,29,47,58,64,91,102').split(',').map(Number);

const blob = JSON.parse(fs.readFileSync(weightsPath, 'utf8'));
const w = Float64Array.from(blob.weights);
const shape = blob.shape;
if (shape[0] !== FEATURES) {
  throw new Error(`weights expect ${shape[0]} features, encoder makes ${FEATURES}`);
}

/** mulberry32 — so a det+temp validation rolls the same dice every time. */
function mulberry32(a) {
  a = a >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
let rng = Math.random;

/** Sample from softmax(logits/T); returns [index, logProb]. */
function sample(logits) {
  let mx = -Infinity;
  for (const v of logits) if (v > mx) mx = v;
  const ex = logits.map((v) => Math.exp((v - mx) / (TEMP || 1)));
  const Z = ex.reduce((a, b) => a + b, 0);
  if (TEMP === 0) {
    let best = 0;
    for (let j = 1; j < logits.length; j++) if (logits[j] > logits[best]) best = j;
    return [best, Math.log(ex[best] / Z)];
  }
  let r = rng() * Z;
  for (let j = 0; j < ex.length; j++) {
    r -= ex[j];
    if (r <= 0) return [j, Math.log(ex[j] / Z)];
  }
  return [ex.length - 1, Math.log(ex[ex.length - 1] / Z)];
}

const lines = [];
let returns = [];
for (let e = 0; e < EPISODES; e++) {
  const seed = SEEDS[e % SEEDS.length];
  const { harness, game } = await bootGame({ fresh: true, seed });
  const play = () => game.scenes.all().find((s) => s.constructor.name === 'PlayScene');
  let waveHits = 0;
  const stopListening = game.events.on('waveClear', () => { waveHits++; });

  rng = DET ? mulberry32(seed ^ 0x9e3779b9) : Math.random;
  globalThis.window.__harness.pinSeed(seed);
  harness.beginRun({ kind: 'scenario', scenario: {
    room: ROOM, quiet: true,
    player: { ...(ROOM === 'throne'
      ? { x: RAND_SPAWN && !DET ? 80 + Math.floor(Math.random() * 480) : 120, y: 100 }
      : { x: RAND_SPAWN && !DET ? 120 + Math.floor(Math.random() * 700) : 230, y: 192 }),
      give: ['great-sword'], equip: ['great-sword'] },
  } });
  harness.step([], 30);

  const boss0 = game.world.all().find((m) => m.def?.boss && !m.dead);
  const x = new Float64Array(FEATURES);
  const scratch = {};
  let hp = play()?.player?.hp ?? 0;
  let score = 0;
  let wavesPaid = 0;
  let total = 0;
  const ep = [];

  for (let f = 0; f < EPISODE; f++) {
    const p = play()?.player;
    if (!p || p.hp <= 0) break;
    const o = globalThis.window.__observe();
    // Menus are protocol, not policy — handled outside the trajectory,
    // exactly as actor() does, so the net never trains on them.
    if (o?.ui?.blocking) { harness.step(['confirm'], 1); continue; }
    encode(o, x, null);
    const [a, lp] = sample(forwardLogits(w, x, shape, scratch));
    harness.step(MOVES[a], 1);

    // The reward for THIS step: what changed because time advanced.
    let r = REWARD.frame;
    const p2 = play()?.player;
    const st = harness.state();
    const sc = st.score ?? 0;
    r += REWARD.kill * (sc - score);
    score = sc;
    if (p2 && p2.hp < hp) r += REWARD.hit;
    hp = p2?.hp ?? 0;
    if (waveHits > wavesPaid) { r += REWARD.wave * (waveHits - wavesPaid); wavesPaid = waveHits; }
    const died = !p2 || p2.hp <= 0;
    const bossDead = !!boss0 && (boss0.dead || boss0.hp <= 0);
    const won = ROOM === 'throne' ? bossDead : wavesPaid >= 5;
    if (died) r += REWARD.death;
    if (won) r += REWARD.clear;
    const done = died || won;
    total += r;
    ep.push(JSON.stringify({
      o: Array.from(x, (v) => Math.round(v * 1000) / 1000),
      a, lp: Math.round(lp * 10000) / 10000, r: Math.round(r * 100) / 100, d: done ? 1 : 0,
    }));
    if (done) break;
  }
  stopListening();
  lines.push(...ep);
  returns.push(Math.round(total));
  await close();
}

fs.writeFileSync(outPath, lines.join('\n') + '\n');
console.log(JSON.stringify({
  episodes: EPISODES, steps: lines.length, out: outPath,
  returns, meanReturn: Math.round(returns.reduce((a, b) => a + b, 0) / returns.length),
}));
process.exit(0);
