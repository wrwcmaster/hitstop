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
  for (const [step, want] of rec.checks) {
    harness.runTo(step);
    const got = harness.hashNow();
    if (got !== want) { bad = { step, want, got }; break; }
  }
  if (bad) {
    failed++;
    console.log(`FAIL ${f}: DIVERGED at step ${bad.step} (recorded ${bad.want}, replayed ${bad.got})`);
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
