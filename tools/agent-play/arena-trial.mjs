/**
 * Score a policy against level 1: five waves in the arena, and how often
 * it gets through them untouched.
 *
 *   node tools/agent-play/arena-trial.mjs                      # default policy, 5 seeds
 *   node tools/agent-play/arena-trial.mjs --seeds 1,2,3        # pick the seeds
 *   node tools/agent-play/arena-trial.mjs --policy ./mine.mjs  # score something else
 *   node tools/agent-play/arena-trial.mjs --why                # per-hit blame
 *
 * Two things here were mistakes the first time and are the reason the
 * file exists rather than a heredoc:
 *
 * ONE SEED PER BOOT. The harness reads its seed once, at boot
 * (`bootReplay`), so calling `beginRun` in a loop replays the SAME seed
 * every time and the runs differ only by whatever state leaked between
 * them. That reads exactly like seed variation and is not.
 *
 * CLEARING IS AN EVENT, NOT A COUNTER. `WaveRunner` stops at the goal —
 * it fires `waveClear` for the last wave and drops the gate key, and the
 * counter never goes past 5. Waiting for `wave > 5` waits forever, which
 * scored two genuine clears as timeouts.
 *
 * DEATH IS AN FSM STATE, NOT `Actor.dead`. A killed knight goes to fsm
 * state 'dead' and stays in the world with negative hp; `dead` marks an
 * actor for REMOVAL and is never set on her. Checking it scored deaths
 * as timeouts — runs sat at the 40,000-frame cap with hp of -20, and the
 * distinction between "lost the fight" and "could not finish it" is the
 * whole point of the report.
 */
import { bootGame, close } from './headless.mjs';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
};
const seeds = arg('--seeds', '1,7,42,99,2024').split(',').map(Number);
const policyPath = arg('--policy', './policies/untouchable.mjs');
const why = process.argv.includes('--why');
const CAP = 40000; // ~11 minutes of game time: a stall, not a slow win

const policy = await import(policyPath);

/** One seeded run. Returns how it went. */
async function trial(seed) {
  const { harness, game } = await bootGame({ fresh: true, seed });
  const play = () => game.scenes.all().find((s) => s.constructor.name === 'PlayScene');
  let cleared = false;
  game.events.on('waveClear', (e) => { if (e.wave >= 5) cleared = true; });

  policy.reset?.();
  harness.beginRun({ kind: 'scenario', scenario: {
    room: 'arena', quiet: true,
    player: { x: 230, y: 192, give: ['great-sword'], equip: ['great-sword'] },
  } });
  harness.step([], 30); // let the room settle before the first decision

  let hurt = 0, wave = 0, f = 0;
  const blame = {};
  let hp = play()?.player?.hp ?? 0;
  for (; f < CAP && !cleared; f++) {
    const p = play()?.player;
    if (!p || p.hp <= 0) break;
    wave = Math.max(wave, harness.state().wave?.n ?? 0);
    if (p.hp < hp) {
      hurt++;
      hp = p.hp;
      // Blame whatever is close enough to have done it. Contact damage is
      // the overwhelming majority; 'ranged' means nothing was in touching
      // distance, so it came in through the air.
      const near = game.world.all()
        .filter((a) => !a.dead && a !== p && Math.hypot((a.cx ?? a.x) - p.cx, (a.cy ?? a.y) - p.cy) < 40)
        .map((a) => a.type ?? a.constructor.name);
      const k = near.length ? near.sort().join('+') : 'ranged';
      blame[k] = (blame[k] ?? 0) + 1;
    }
    harness.step(policy.decide(globalThis.window.__observe()), 1);
  }
  const p = play()?.player;
  await close();
  return {
    seed, wave, hurt, frames: f, blame,
    hp: p?.hp ?? 0,
    how: cleared ? 'CLEARED' : !p || p.hp <= 0 ? 'DIED' : 'timeout',
  };
}

let cleared = 0, flawless = 0;
for (const seed of seeds) {
  const r = await trial(seed);
  if (r.how === 'CLEARED') cleared++;
  if (r.how === 'CLEARED' && r.hurt === 0) flawless++;
  console.log(
    `seed ${String(r.seed).padStart(5)}: wave ${r.wave}  hp ${String(r.hp).padStart(4)}`
    + `  hurt ${String(r.hurt).padStart(2)}  ${String(r.frames).padStart(5)}f  ${r.how}`
    + (why && Object.keys(r.blame).length ? `  by ${JSON.stringify(r.blame)}` : ''),
  );
}
console.log(`\ncleared ${cleared}/${seeds.length}, flawless ${flawless}/${seeds.length}`);
process.exit(0);
