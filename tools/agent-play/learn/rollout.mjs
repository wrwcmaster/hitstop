/**
 * One episode: put a policy in the arena and see how it does.
 *
 * Shared by training and evaluation so they cannot drift apart — a
 * learner that is scored differently from how it is trained will
 * cheerfully optimise the gap.
 */
import { encode, MOVES } from './features.mjs';
import { forward, SHAPE } from './net.mjs';

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
export function episode(harness, game, act, { frames = EPISODE } = {}) {
  const play = () => game.scenes.all().find((s) => s.constructor.name === 'PlayScene');
  let waves = 0;
  // `on` hands back an unsubscribe — there is no `off`. A training run is
  // thousands of episodes against one boot, so forgetting to call it
  // leaks a listener per episode and slows every emit for the rest of
  // the generation.
  const stopListening = game.events.on('waveClear', (e) => {
    waves = Math.max(waves, e.wave);
  });

  harness.beginRun({ kind: 'scenario', scenario: {
    room: 'arena', quiet: true,
    player: { x: 230, y: 192, give: ['great-sword'], equip: ['great-sword'] },
  } });
  harness.step([], 30);

  let hp = play()?.player?.hp ?? 0;
  let hits = 0;
  let score = 0;
  let f = 0;
  let died = false;
  for (; f < frames; f++) {
    const p = play()?.player;
    if (!p || p.hp <= 0) { died = true; break; }
    if (p.hp < hp) { hits++; hp = p.hp; }
    const st = harness.state();
    score = st.score ?? 0;
    harness.step(act(globalThis.window.__observe()), 1);
  }
  stopListening();

  const cleared = waves >= 5;
  const fitness = REWARD.wave * waves
    + (cleared ? REWARD.clear : 0)
    + REWARD.kill * score
    + REWARD.hit * hits
    + REWARD.frame * f
    + (died ? REWARD.death : 0);
  return { fitness, waves, hits, score, frames: f, died, cleared };
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
export function actor(weights, shape = SHAPE, goalOf = null) {
  const scratch = {};
  const x = encode({ player: null, monsters: [], shots: [] });
  return (o) => {
    // A menu owns the screen: the only useful key is confirm, and that is
    // protocol rather than strategy. Teaching a net to rediscover it
    // would burn episodes on something the game never varies.
    if (o?.ui?.blocking) return ['confirm'];
    if (!o?.player) return [];
    encode(o, x, goalOf ? goalOf() : null);
    return MOVES[forward(weights, x, shape, scratch)];
  };
}
