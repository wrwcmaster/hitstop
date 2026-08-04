/**
 * Verify every recording bit-for-bit, in Node, in one process.
 *
 *   npm run replay:headless          # all of tools/agent-play/recordings/
 *   node tools/agent-play/replay-headless.mjs [names...]
 *
 * Same verdicts as `npm run replay`, ~10x faster (one boot, no browser,
 * no dev server, no pages). The browser runner remains the gold path —
 * it exercises the real DOM input seam and gets page isolation for free
 * — so run it before shipping; run THIS while iterating.
 *
 * One process is the point, and it is only possible because a run reset
 * actually resets: this suite is what flushed out the run-start bugs
 * (overlays swallowing a queued start, a mid-fade transition driving the
 * next run, a scenario's inline room becoming every later NEW GAME's
 * start room). If a tape passes alone but fails here after another tape,
 * that is not a harness quirk — it is the next such bug. Bisect the
 * predecessor, fix the game.
 */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bootGame, close } from './headless.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const dir = path.join(here, 'recordings');

const wanted = process.argv.slice(2);
const files = readdirSync(dir)
  .filter((f) => f.endsWith('.json'))
  .filter((f) => !wanted.length || wanted.includes(f) || wanted.includes(f.replace('.json', '')));
if (!files.length) {
  console.error('no recordings matched');
  process.exit(2);
}

const t0 = Date.now();
const { harness, storage } = await bootGame();
let failed = 0;
for (const f of files) {
  const rec = JSON.parse(readFileSync(path.join(dir, f), 'utf8'));
  // The tape's own storage snapshot, exactly like a fresh page would have.
  storage.load(rec.storage ?? {});
  const t = Date.now();
  harness.replayRun(rec);
  let bad = null;
  // The stream parts BEFORE the worlds do: a cosmetic that draws from the
  // gameplay stream moves it without moving a hashed field, and the tape
  // stays clean until something rolls. Walk the draw counts to the end
  // even after a hash fails, so the report names the earlier cause rather
  // than the later symptom.
  const drawLog = new Map((rec.draws ?? []).map(([s, n]) => [s, n]));
  let firstDrift = null;
  for (const [step, want] of rec.checks) {
    harness.runTo(step);
    const got = harness.hashNow();
    if (firstDrift === null && drawLog.has(step)) {
      const drew = harness.draws();
      if (drew !== drawLog.get(step)) firstDrift = { step, want: drawLog.get(step), got: drew };
    }
    if (got !== want && !bad) { bad = { step, want, got }; if (!drawLog.size || firstDrift) break; }
  }
  if (bad) {
    failed++;
    console.log(`FAIL ${f}: DIVERGED at step ${bad.step} (recorded ${bad.want}, replayed ${bad.got})`);
    if (firstDrift) {
      const d = firstDrift.got - firstDrift.want;
      console.log(`     RNG stream drifted first at step ${firstDrift.step}: recorded ${firstDrift.want} draws, replayed ${firstDrift.got} (${d > 0 ? '+' : ''}${d})`
        + `${firstDrift.step < bad.step ? ` — ${bad.step - firstDrift.step} steps before the worlds parted` : ''}`);
    } else if (drawLog.size) {
      console.log('     RNG stream stayed in lockstep — the difference is in the world, not the dice.');
    }
  } else if (firstDrift) {
    // Every hash matched and the dice still differ. This is the shape the
    // bug takes before it is a bug: the tape is already unreproducible and
    // only luck (or a short tape) is hiding it. Loud, but not a failure —
    // nothing observable is wrong yet.
    failed++;
    const d = firstDrift.got - firstDrift.want;
    console.log(`FAIL ${f}: every hash matched, but the RNG stream drifted at step ${firstDrift.step}`
      + ` (recorded ${firstDrift.want} draws, replayed ${firstDrift.got}, ${d > 0 ? '+' : ''}${d})`);
    console.log('     The worlds have not parted YET — they would have, given more tape.');
  } else {
    console.log(`pass ${f}  ${rec.end} steps, ${rec.checks.length} checkpoints (${Date.now() - t}ms)`);
  }
}
console.log(
  failed
    ? `${failed}/${files.length} recording(s) FAILED`
    : `all ${files.length} recording(s) reproduced exactly (${Date.now() - t0}ms total)`,
);
await close();
process.exit(failed ? 1 : 0);
