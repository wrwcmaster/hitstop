/**
 * The whole task, end to end: start where the game starts, reach the
 * Slime King, kill him.
 *
 *   node tools/agent-play/king-run.mjs
 *   node tools/agent-play/king-run.mjs --seeds 1,7,42 --verbose
 *
 * `arena-trial.mjs` scores one room. This scores the run, and the
 * difference matters: an arena policy that clears five waves and then
 * stands in the corner has not progressed at all, because the gate key
 * drops and nobody walks through the gate. That failure is invisible to
 * the trial and fatal to the goal.
 *
 * The route is not learned. BFS over the room graph (`learn/world.mjs`)
 * plans arena > cavern > corridor > throne in microseconds and is always
 * right; the policy's job is the moving and the fighting. Planner
 * decides WHERE, policy handles HOW — the split exists because the
 * reward for "reach a room three doors away" arrives never, so there is
 * nothing for a learner to climb.
 */
import { bootGame, close } from './headless.mjs';
import { loadWorld, route, doorTo } from './learn/world.mjs';

const arg = (n, d) => {
  const i = process.argv.indexOf(n);
  return i >= 0 ? process.argv[i + 1] : d;
};
const seeds = arg('--seeds', '1,7,42,99,2024').split(',').map(Number);
const verbose = process.argv.includes('--verbose');
const CAP = Number(arg('--cap', 60000));

const rooms = loadWorld();
const PATH = route(rooms, 'arena', 'throne');

/**
 * Drive one run.
 *
 * The policy fights; this decides what it is currently for. Three phases,
 * and the transitions are facts about the game rather than judgement:
 * the arena gate needs a key, the key drops when the waves are done, and
 * the throne is done when the king is.
 */
async function run(seed, policy) {
  const { harness, game } = await bootGame({ fresh: true, seed });
  const play = () => game.scenes.all().find((s) => s.constructor.name === 'PlayScene');
  policy.reset?.();

  harness.beginRun({ kind: 'scenario', scenario: {
    room: 'arena', quiet: true,
    player: { give: ['great-sword'], equip: ['great-sword'] },
  } });
  harness.step([], 30);

  let goal = null;
  const goalOf = () => goal;
  const act = policy.make ? policy.make(goalOf) : (o) => policy.decide(o, goalOf());

  const log = [];
  let reached = 'arena';
  let hits = 0;
  let hp = play()?.player?.hp ?? 0;
  let kingDead = false;
  let f = 0;

  for (; f < CAP; f++) {
    const p = play()?.player;
    if (!p || p.hp <= 0) break;
    if (p.hp < hp) hits++;
    hp = p.hp;

    const st = harness.state();
    const here = (st.roomId ?? 'arena').replace(/-/g, '_');
    if (here !== reached) {
      log.push(`${here} @${f}f`);
      reached = here;
    }

    if (here === 'throne') {
      const king = game.world.all().find((e) => e.type === 'slime-king' && !e.dead);
      if (!king) { kingDead = true; break; }
      goal = { x: king.cx, y: king.cy, kind: 2 };     // kill it
    } else {
      const at = PATH.indexOf(here);
      const next = at >= 0 && at + 1 < PATH.length ? PATH[at + 1] : null;
      const door = next ? doorTo(rooms, here, next) : null;
      // The arena gate wants a key that only drops when the waves are
      // done, so until then the job is to fight, not to travel.
      const needsKey = here === 'arena' && !p.inventory?.has?.('gate-key');
      // The way back, so the driver can avoid being knocked through it.
      const back = at > 0 ? doorTo(rooms, here, PATH[at - 1]) : null;
      goal = needsKey || !door
        ? { x: p.cx, y: p.cy, kind: 2, avoid: back }
        : { x: door.x, y: door.y, kind: 1, avoid: back };
    }
    harness.step(act(globalThis.window.__observe()), 1);
  }

  const p = play()?.player;
  await close();
  return {
    seed, reached, hits, frames: f, kingDead,
    hp: p?.hp ?? 0,
    how: kingDead ? 'KING DEAD' : !p || p.hp <= 0 ? 'died' : 'timeout',
    log,
  };
}

const policyPath = arg('--policy', './learn/hybrid.mjs');
const policy = await import(policyPath);

console.log(`route: ${PATH.join(' > ')}`);
console.log(`policy: ${policyPath}\n`);
let won = 0;
for (const seed of seeds) {
  const r = await run(seed, policy);
  if (r.kingDead) won++;
  console.log(`seed ${String(r.seed).padStart(5)}: got to ${r.reached.padEnd(9)}`
    + ` hp ${String(r.hp).padStart(4)} hits ${String(r.hits).padStart(2)}`
    + ` ${String(r.frames).padStart(6)}f  ${r.how}`
    + (verbose && r.log.length ? `\n            via ${r.log.join(' -> ')}` : ''));
}
console.log(`\nkilled the king ${won}/${seeds.length}`);
process.exit(0);
