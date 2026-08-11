/**
 * Human tape -> training pairs. The imitation half of the pipeline.
 *
 *   node tools/agent-play/learn/demo.mjs recordings/human-throne-win.json \
 *        --out tools/agent-play/learn/demo.jsonl
 *
 * Why this exists: the net corners. Under the reward, hit-and-run is
 * worth MORE than camping, and PPO still will not go there, because
 * every path from the corner to hit-and-run runs through worse play —
 * leave the wall and you eat hits before the new habit pays. That is a
 * valley, and policy gradient does not cross valleys. The standard way
 * out is to be SHOWN, and the only demonstrator that was ever available
 * (the rule bot) dies to the king 0/5: its style is right and its
 * outcomes are fatal, so cloning it clones dying.
 *
 * A human tape is the demonstrator that works. It replays bit-for-bit,
 * so the observation the net would have seen is recomputable at every
 * frame — which turns a recording into supervised (state -> action)
 * pairs with no extra instrumentation at all.
 *
 * Labels come from the tape's own held keys, mapped into the SAME 18
 * combos the policy chooses from (features.mjs MOVES). Frames a policy
 * would never own are dropped: menus (protocol, not play, exactly as
 * collect.mjs treats them) and everything after the boss dies (idling
 * over a corpse teaches idling).
 */
import fs from 'node:fs';
import { bootGame, close } from '../headless.mjs';
import { encode, MOVES, FEATURES } from './features.mjs';

const arg = (n, d) => {
  const i = process.argv.indexOf(n);
  return i >= 0 ? process.argv[i + 1] : d;
};
const tapes = process.argv.slice(2).filter((a) => !a.startsWith('--') && a.endsWith('.json'));
const outPath = arg('--out', 'tools/agent-play/learn/demo.jsonl');
if (!tapes.length) {
  console.error('usage: demo.mjs <tape.json> [more.json...] [--out demo.jsonl]');
  process.exit(2);
}

/** The actions the policy can express; everything else is not its vocabulary. */
const VOCAB = ['left', 'right', 'jump', 'attack', 'dash'];
const KEY = (set) => [...set].filter((a) => VOCAB.includes(a)).sort().join('+');
const MOVE_BY_KEY = new Map(MOVES.map((m, i) => [[...m].sort().join('+'), i]));

/**
 * Held keys -> a move index. A human can hold combinations the policy
 * cannot say (left AND right through a flip, attack during a menu), so
 * the mapping resolves rather than fails: newest direction wins, and an
 * unrepresentable extra is dropped until something fits. Returns null
 * only if even the empty set somehow misses, which cannot happen.
 */
function moveIndex(held, pressOrder) {
  const set = new Set([...held].filter((a) => VOCAB.includes(a)));
  if (set.has('left') && set.has('right')) {
    // Both down mid-flip: keep whichever was pressed later.
    set.delete((pressOrder.get('left') ?? 0) > (pressOrder.get('right') ?? 0) ? 'right' : 'left');
  }
  let idx = MOVE_BY_KEY.get(KEY(set));
  if (idx !== undefined) return idx;
  // Shed the least decisive keys until the combo is one the net can pick.
  for (const drop of ['dash', 'jump', 'attack']) {
    if (set.delete(drop)) {
      idx = MOVE_BY_KEY.get(KEY(set));
      if (idx !== undefined) return idx;
    }
  }
  return MOVE_BY_KEY.get('') ?? 0;
}

const lines = [];
const perMove = new Array(MOVES.length).fill(0);
let dropped = 0;

for (const tapePath of tapes) {
  const rec = JSON.parse(fs.readFileSync(tapePath, 'utf8'));
  const { harness, storage, game } = await bootGame({ fresh: true });
  storage.load(rec.storage ?? {});
  harness.replayRun(rec);

  const held = new Set();
  const pressOrder = new Map();
  const x = new Float64Array(FEATURES);
  let cursor = 0;
  let kept = 0;
  let killedAt = null;
  let seenBoss = false;

  for (let s = 0; s <= rec.end; s++) {
    harness.runTo(s);
    // Mirror the tape's key state: the replay driver already applied
    // these to the sim, this is only to LABEL the frame.
    while (cursor < rec.tape.length && rec.tape[cursor][0] <= s) {
      const ev = rec.tape[cursor++];
      if (ev[1] === 'd') { held.add(ev[2]); pressOrder.set(ev[2], s); }
      else if (ev[1] === 'u') held.delete(ev[2]);
    }
    // "No boss" means the fight is OVER only once there has been one —
    // at frame 0 the run has not spawned it yet, and stopping there ends
    // the harvest before it starts.
    const boss = game.world.all().find((e) => e.def?.boss);
    if (boss && !boss.dead && boss.hp > 0) seenBoss = true;
    else if (seenBoss) { killedAt = s; break; }

    const o = globalThis.window.__observe();
    if (!o?.player || o.ui?.blocking) { dropped++; continue; }
    encode(o, x, null);
    const a = moveIndex(held, pressOrder);
    perMove[a]++;
    kept++;
    lines.push(JSON.stringify({ o: Array.from(x, (v) => Math.round(v * 1000) / 1000), a }));
  }
  console.log(`${tapePath}: ${kept} pairs${killedAt ? `, boss down at frame ${killedAt} (${(killedAt / 60).toFixed(0)}s)` : ', boss survived'}`);
  await close();
}

fs.writeFileSync(outPath, lines.join('\n') + '\n');
const top = perMove.map((n, i) => [n, i]).sort((a, b) => b[0] - a[0]).slice(0, 8);
console.log(`\n${lines.length} pairs -> ${outPath}  (${dropped} frames dropped: menus/no player)`);
console.log('most-used moves: ' + top.map(([n, i]) => `[${MOVES[i].join('+') || 'idle'}] ${(n / lines.length * 100).toFixed(0)}%`).join('  '));
process.exit(0);
