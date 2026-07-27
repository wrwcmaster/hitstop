/**
 * Bug tapes as cheap semantic regression tests.
 *
 *   node tools/agent-play/bugtest.mjs               # run tools/agent-play/bugs/*.json
 *   node tools/agent-play/bugtest.mjs --new path/to/recording.json [name]
 *
 * A checkpoint-hash recording (recordings/) asserts the whole sim
 * bit-for-bit — perfect for determinism, brittle for bugs: every
 * deliberate feel change diverges it, and --rerecord refreshes hashes
 * without ever asking whether the BUG is still gone. A bug test pins
 * what the bug report was actually about and nothing else:
 *
 *   - journey: the exact sequence of rooms the tape visits
 *   - bounds:  the player stays inside the room's extent every frame
 *   - warps:   no same-room position jump bigger than physics allows
 *   - end:     where the tape must come to rest
 *
 * `--new` plays a recording (a SAVE REPLAY file from a bug report),
 * observes those properties on the CURRENT build, and writes
 * bugs/<name>.json with the observations as expectations — so the flow
 * is: fix the bug first, then mint the test from the fixed behavior.
 * Review the printed expectations before committing them.
 *
 * Each bugs/*.json: { name, issue, expect, recording } — `issue` is a
 * sentence about the original bug, `expect` is what --new observed
 * (hand-tighten freely), `recording` is the untouched tape.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchBrowser, openSession } from './lib.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const bugDir = path.join(here, 'bugs');

/** Play a recording's tape frame by frame IN PAGE, returning a compact trace. */
async function traceTape(browser, recording) {
  const { page, errors } = await openSession(browser, recording.seed, {
    storage: recording.storage ?? {},
  });
  const trace = await page.evaluate(async (rec) => {
    window.__harness.beginRun(rec.start);
    window.__harness.step([], 1);
    const edges = rec.tape.filter((e) => e[1] === 'd' || e[1] === 'u');
    const held = new Set();
    let cursor = 0;
    const rooms = [];
    const frames = [];
    for (let f = 1; f <= rec.end; f++) {
      while (cursor < edges.length && edges[cursor][0] === f) {
        const [, kind, action] = edges[cursor];
        if (kind === 'd') held.add(action); else held.delete(action);
        cursor++;
      }
      const st = window.__harness.step([...held], 1);
      const sc = window.hitstop.scenes.all().find((s) => s.constructor.name === 'PlayScene');
      const p = st.player;
      if (!p) continue;
      if (!rooms.length || rooms[rooms.length - 1] !== st.roomId) rooms.push(st.roomId);
      frames.push([st.roomId, p.x, p.y, sc?.tilemap?.worldW ?? 0, sc?.tilemap?.worldH ?? 0]);
    }
    const last = frames[frames.length - 1];
    return { rooms, frames, end: { room: last[0], x: last[1], y: last[2] } };
  }, recording);
  await page.context().close();
  return { trace, errors };
}

/** The semantic properties of a trace: what a bug test asserts. */
function measure(trace) {
  let outOfBounds = null;
  let maxWarp = 0;
  let prev = null;
  for (const [room, x, y, w, h] of trace.frames) {
    // Edge walks deliberately carry the knight ~22px past the side
    // boundary mid-transition; vertical arrivals legally touch y=0 and
    // feet=worldH exactly. The slack covers those mechanics and nothing
    // else — real clip bugs (a landing 72px above the ceiling) are an
    // order of magnitude outside it.
    if (w && (x < -26 || y < -2 || x > w - 14 + 26 || y > h - 17)) {
      outOfBounds ??= `${room} (${Math.round(x)},${Math.round(y)}) vs ${w}x${h}`;
    }
    if (prev && prev[0] === room) {
      maxWarp = Math.max(maxWarp, Math.hypot(x - prev[1], y - prev[2]));
    }
    prev = [room, x, y];
  }
  return { outOfBounds, maxWarp };
}

function check(bug, trace, stats) {
  const fails = [];
  const e = bug.expect;
  if (e.rooms && JSON.stringify(e.rooms) !== JSON.stringify(trace.rooms)) {
    fails.push(`journey ${trace.rooms.join(' > ')} != expected ${e.rooms.join(' > ')}`);
  }
  if (e.inBounds && stats.outOfBounds) fails.push(`left the world at ${stats.outOfBounds}`);
  if (e.maxWarp != null && stats.maxWarp > e.maxWarp) {
    fails.push(`same-room warp of ${stats.maxWarp.toFixed(1)}px (allowed ${e.maxWarp})`);
  }
  if (e.end?.room && trace.end.room !== e.end.room) {
    fails.push(`ends in ${trace.end.room}, expected ${e.end.room}`);
  }
  if (e.end?.y != null && Math.abs(trace.end.y - e.end.y) > (e.end.tolerance ?? 8)) {
    fails.push(`ends at y=${Math.round(trace.end.y)}, expected ~${e.end.y}`);
  }
  return fails;
}

const args = process.argv.slice(2);
const browser = await launchBrowser();
let failed = 0;

if (args[0] === '--new') {
  const src = JSON.parse(fs.readFileSync(args[1], 'utf8'));
  const name = (args[2] ?? path.basename(args[1], '.json')).replace(/[^\w-]/g, '_');
  const { trace, errors } = await traceTape(browser, src);
  const stats = measure(trace);
  const bug = {
    name,
    issue: 'DESCRIBE THE ORIGINAL BUG HERE',
    expect: {
      rooms: trace.rooms,
      inBounds: true,
      // Observed max is padded: physics headroom, not a hash.
      maxWarp: Math.ceil(stats.maxWarp) + 8,
      end: { room: trace.end.room, y: Math.round(trace.end.y) },
    },
    recording: src,
  };
  fs.mkdirSync(bugDir, { recursive: true });
  const file = path.join(bugDir, `${name}.json`);
  fs.writeFileSync(file, JSON.stringify(bug, null, 1));
  console.log(`minted ${file}`);
  console.log('  journey:', trace.rooms.join(' > '));
  console.log('  end    :', trace.end.room, 'y=' + Math.round(trace.end.y));
  console.log('  maxWarp:', stats.maxWarp.toFixed(1), '-> allowed', bug.expect.maxWarp);
  console.log('  bounds :', stats.outOfBounds ?? 'stayed inside');
  if (errors.length) console.log('  page errors:', errors);
  console.log('Edit the `issue` field, tighten `expect` if you like, then commit.');
} else {
  const files = fs.existsSync(bugDir) ? fs.readdirSync(bugDir).filter((f) => f.endsWith('.json')) : [];
  if (!files.length) console.log('no bug tapes in', bugDir);
  for (const f of files) {
    const bug = JSON.parse(fs.readFileSync(path.join(bugDir, f), 'utf8'));
    const { trace, errors } = await traceTape(browser, bug.recording);
    const fails = check(bug, trace, measure(trace));
    if (errors.length) fails.push(`page errors: ${errors.join('; ')}`);
    if (fails.length) {
      failed++;
      console.log(`FAIL ${bug.name} — ${bug.issue}`);
      for (const why of fails) console.log(`   ${why}`);
    } else {
      console.log(`pass ${bug.name} (${trace.rooms.join(' > ')})`);
    }
  }
}

await browser.close();
process.exit(failed ? 1 : 0);
