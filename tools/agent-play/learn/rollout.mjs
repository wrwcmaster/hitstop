/**
 * One episode: put a policy in the arena and see how it does.
 *
 * Shared by training and evaluation so they cannot drift apart — a
 * learner that is scored differently from how it is trained will
 * cheerfully optimise the gap.
 */
import { encode, MOVES } from './features.mjs';
import { forward, forwardLogits, SHAPE } from './net.mjs';

/**
 * Frames a training episode is allowed.
 *
 * Was 1800, then 4200. Both were prefixes: at 4200 it reached wave 3,
 * met an archer once and a gunner never, and then died to them in every
 * held-out evaluation. 12000 frames covers a full clear, so the policy
 * trains on the task it is scored on. Episodes end early on death, so
 * the cost is paid mostly by policies that are already surviving.
 */
export const EPISODE = 12000;

/**
 * What we are actually asking for.
 *
 * The goal is "clear it without being hurt", so a hit has to cost more
 * than a kill pays or the fastest route to a high score is to trade.
 * Time is charged a little, because a policy that survives by refusing
 * to engage is not solving the problem — an earlier hand-written one
 * did exactly that and stalled past 25,000 frames looking safe.
 */
export const REWARD = {
  wave: 400,
  // Per point of GAME SCORE, and a wave of kills scores over a thousand.
  // At 1.0 the first version made killing worth roughly fifteen times
  // more than avoiding every hit in the wave, so the policy learned to
  // trade — precisely the behaviour the comment above claimed to
  // prevent. The weight has to be read against the units it multiplies.
  kill: 0.12,
  hit: -150,
  // Finishing has to be worth more than surviving, or it is not worth
  // anything. With time charged at 0.004 a frame, dragging a run to the
  // 40,000-frame cap cost 160 against a wave worth 400 — so three
  // held-out seeds ended alive on 110+ HP with two hits and never
  // finished wave 5. Inside a 12,000-frame episode "cleared quickly"
  // and "still standing" scored the same, so nothing ever taught it the
  // difference.
  clear: 2000,
  // Time, charged properly. At -0.02 an eight-minute corner camp scored
  // 3434 against a brisk clear's 3454 — a 20-point gap on 3400, which is
  // noise, so the learner took the easy one: it ran to the left wall,
  // held left and attack, and let five waves path into the sword. Mean x
  // was 3 in an arena 960 wide, motionless for 90% of the run, and it
  // finished on 120/120 HP looking like skill. At -0.1 the same camp
  // scores 1194 against 3094.
  frame: -0.1,
  // Raised with it. A big time charge makes a long honest attempt cost
  // more than a quick death, and a policy will notice that before you do.
  death: -2000,
};

/**
 * Play one episode with `act(observation) -> keys`.
 *
 * Returns the fitness plus the numbers worth watching while it trains.
 */
/**
 * One episode. `room` picks the task: the arena teaches wave-fighting;
 * the throne teaches the Slime King, who the net can now SEE telegraph
 * (mode + kinematics) but has never once trained against — every
 * previous run only ever met slimes and bats, so "do not stand under
 * the falling king" had no episodes to be learned in.
 */
export function episode(harness, game, act, { frames = EPISODE, runSeed = null, room = 'arena' } = {}) {
  const play = () => game.scenes.all().find((s) => s.constructor.name === 'PlayScene');
  let waves = 0;
  // `on` hands back an unsubscribe — there is no `off`. A training run is
  // thousands of episodes against one boot, so forgetting to call it
  // leaks a listener per episode and slows every emit for the rest of
  // the generation.
  const stopListening = game.events.on('waveClear', (e) => {
    waves = Math.max(waves, e.wave);
  });

  // Pin BEFORE beginRun, not after. Every candidate must face the same
  // arena, or an antithetic pair compares two different problems and the
  // difference measures noise rather than the perturbation. Harness runs
  // normally derive a fresh seed each time (boot.seed + 0x9e3779b9 *
  // ++runCount), so booting once per seed is NOT enough — I believed it
  // was, and the same weights run four times scored -176, -200, -176,
  // -323. Reseeding AFTER beginRun does not work either: the room and
  // its wave queue are already built by then. Pinned, the same weights
  // score -188, -188, -188.
  if (runSeed !== null) globalThis.window.__harness.pinSeed(runSeed);
  harness.beginRun({ kind: 'scenario', scenario: {
    room, quiet: true,
    player: { ...(room === 'throne' ? { x: 120, y: 100 } : { x: 230, y: 192 }),
      give: ['great-sword'], equip: ['great-sword'] },
  } });
  // Pin BEFORE beginRun, not after. Every candidate must face the same
  // arena, or an antithetic pair compares two different problems and the
  // difference measures noise rather than the perturbation. Harness runs
  // normally derive a fresh seed each time (boot.seed + 0x9e3779b9 *
  // ++runCount), so booting once per seed is NOT enough — I believed it
  // was, and the same weights run four times scored -176, -200, -176,
  // -323. Reseeding AFTER beginRun does not work either: the room and
  // its wave queue are already built by then.
  harness.step([], 30);

  // A boss episode is scored on the boss. Grab him now; his absence at
  // the end IS the win condition.
  const boss0 = game.world.all().find((e) => e.def?.boss && !e.dead);
  let hp = play()?.player?.hp ?? 0;
  let hits = 0;
  let score = 0;
  let f = 0;
  let died = false;
  for (; f < frames; f++) {
    const p = play()?.player;
    if (!p || p.hp <= 0) { died = true; break; }
    // Compare with the PREVIOUS FRAME, not the lowest hp so far. Kills
    // level her up and potions drop, so hp goes back up mid-run; a
    // low-water mark then silently ignores every later hit that lands
    // above it. Measured on one arena run: 8 real damage events, 2
    // counted. The hit penalty was a quarter of what I thought it was.
    if (p.hp < hp) hits++;
    hp = p.hp;
    const st = harness.state();
    score = st.score ?? 0;
    harness.step(act(globalThis.window.__observe()), 1);
  }
  stopListening();

  const bossDead = !!boss0 && (boss0.dead || boss0.hp <= 0);
  const cleared = room === 'throne' ? bossDead : waves >= 5;
  const fitness = REWARD.wave * waves
    + (cleared ? REWARD.clear : 0)
    + REWARD.kill * score
    + REWARD.hit * hits
    + REWARD.frame * f
    + (died ? REWARD.death : 0);
  return { fitness, waves, hits, score, frames: f, died, cleared, bossDead };
}

/**
 * Wrap raw weights as an `act` function, reusing scratch buffers.
 *
 * `goalOf` is optional and supplied by the DRIVER, not the game: it
 * returns {x, y, kind} for whatever the policy is currently trying to
 * do. The observation describes the world; the plan is not part of the
 * world, and putting it in `__observe()` would make the game responsible
 * for knowing where an agent wants to go.
 */
/**
 * Make a policy function from weights.
 *
 * temp 0 (default) is argmax — every deployment so far. temp > 0 samples
 * from softmax(logits/temp): the DICE the trainer actually optimises.
 * The gap between those two is this week's recurring failure — updates
 * that improve the sampled policy while argmax falls off its ridge — so
 * the dice are now deployable, with an optional seeded rng so a sampled
 * evaluation can still be reproduced exactly.
 */
export function actor(weights, shape = SHAPE, goalOf = null, opts = {}) {
  const { temp = 0, rng = Math.random } = opts;
  const scratch = {};
  const x = encode({ player: null, monsters: [], shots: [] });
  return (o) => {
    // A menu owns the screen: the only useful key is confirm, and that is
    // protocol rather than strategy. Teaching a net to rediscover it
    // would burn episodes on something the game never varies.
    if (o?.ui?.blocking) return ['confirm'];
    if (!o?.player) return [];
    encode(o, x, goalOf ? goalOf() : null);
    if (temp <= 0) return MOVES[forward(weights, x, shape, scratch)];
    const lg = forwardLogits(weights, x, shape, scratch);
    let mx = -Infinity;
    for (const v of lg) if (v > mx) mx = v;
    const ex = lg.map((v) => Math.exp((v - mx) / temp));
    const Z = ex.reduce((a, c) => a + c, 0);
    let r = rng() * Z;
    for (let j = 0; j < ex.length; j++) { r -= ex[j]; if (r <= 0) return MOVES[j]; }
    return MOVES[ex.length - 1];
  };
}
