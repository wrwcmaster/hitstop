/**
 * One-shot inspection probes for agents debugging rooms — the cheap
 * alternative to screenshot-driven guesswork. Text answers text-sized
 * questions; the one image command produces a SMALL, targeted PNG.
 *
 *   node tools/agent-play/inspect.mjs grid <room> [c0 c1 r0 r1]
 *   node tools/agent-play/inspect.mjs doors <room>
 *   node tools/agent-play/inspect.mjs shot <room> <x> <y> [out.png] [r] [scale]
 *   node tools/agent-play/inspect.mjs cross <room> <x> <y> <left|right> [frames]
 *
 * grid   — the resolved tilemap as ASCII (legend chars + runtime tiles),
 *          exactly what the game builds: patches, opened doorways, all.
 * doors  — every door trigger: destination, footprint, firing rule,
 *          lock props, and the tiles actually under it.
 * shot   — a PNG around a world point (default r=80, scale=2 → ~320px),
 *          scenario is started quiet so no dialogue covers the view.
 * cross  — walk toward a door and report CROSSED or STAYED, with
 *          positions. The doorway question answered without pixels.
 *
 * Needs the dev server (npm run dev). Each command boots one headless
 * browser and exits; for many probes against one live session, use the
 * bridge (server.mjs) — it has /tiles and clipped /screenshot too.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import {
  launchBrowser, openSession, beginScenario, step, state,
  tileGrid, doorReport, snapWorld,
} from './lib.mjs';
import { loadEngine, bootGame, close as closeHeadless } from './headless.mjs';

const HEADLESS = new Set(['drop', 'trace', 'roundtrip', 'replay']);

/** A body of the knight's size, at rest. */
const knightBody = (x, y, w = 10, h = 18) => ({ x, y, w, h, vx: 0, vy: 0, onGround: false });

/** Read the live player with the fields a physics question actually wants. */
const playerRow = (game) => {
  const sc = game.scenes.all().find((s) => s.constructor.name === 'PlayScene');
  const p = sc?.player;
  return p && {
    room: sc.roomId, x: p.x, y: p.y, vx: p.vx, vy: p.vy,
    grounded: p.onGround, state: p.fsm?.current ?? '?',
    worldW: sc.tilemap?.worldW ?? 0, worldH: sc.tilemap?.worldH ?? 0,
  };
};

/**
 * The TRANSIENT properties a bug tape asserts: did the body ever leave
 * the world, and did it ever jump further in one step than physics
 * allows. Both are invisible at the end of a run — the riven seam clip
 * ended in the right room at the right height while having clipped
 * through a ceiling on the way — so a checker that only reads the final
 * frame passes exactly the regressions these tapes exist to catch.
 *
 * Thresholds mirror bugtest.mjs deliberately: edge walks carry the
 * knight ~22px past the side boundary mid-transition, and vertical
 * arrivals legally touch y=0 and feet=worldH.
 */
const makeSampler = () => {
  let outOfBounds = null;
  let maxWarp = 0;
  let prev = null;
  return {
    sample(r) {
      if (!r) return;
      if (r.worldW && (r.x < -26 || r.y < -2 || r.x > r.worldW - 14 + 26 || r.y > r.worldH - 17)) {
        outOfBounds ??= `${r.room} (${Math.round(r.x)},${Math.round(r.y)}) vs ${r.worldW}x${r.worldH}`;
      }
      if (prev && prev.room === r.room) maxWarp = Math.max(maxWarp, Math.hypot(r.x - prev.x, r.y - prev.y));
      prev = r;
    },
    get result() { return { outOfBounds, maxWarp }; },
  };
};

const fmt = (r) => (r
  ? `${r.room.padEnd(17)} x=${r.x.toFixed(1).padStart(7)} y=${r.y.toFixed(1).padStart(7)}`
    + ` vy=${r.vy.toFixed(1).padStart(7)} grd=${r.grounded ? 1 : 0} ${r.state}`
  : '(no play scene — the run ended outside the world)');

async function runHeadless(cmd, args, usage) {
  if (cmd === 'drop') {
    const [room, x, y, w, h] = args;
    if (!room || x === undefined || y === undefined) usage();
    const eng = await loadEngine();
    if (!eng.ROOMS[room]) { console.error(`no such room "${room}"`); process.exit(1); }
    const map = eng.buildTilemap(eng.ROOMS[room]);
    const b = knightBody(Number(x), Number(y), w ? Number(w) : undefined, h ? Number(h) : undefined);
    let f = 0;
    for (; f < 900 && !b.onGround; f++) { eng.applyGravity(b, 1 / 60); eng.moveAndCollide(b, 1 / 60, map); }
    const under = map.tileAt(Math.floor((b.x + b.w / 2) / 8), Math.floor((b.y + b.h) / 8));
    const def = under ? eng.tiles.get(under) : null;
    console.log(`${room}: a ${b.w}x${b.h} body dropped at (${x},${y})`);
    console.log(`  rests y=${b.y.toFixed(1)} (feet ${(b.y + b.h).toFixed(1)}) after ${f} frames, grounded=${b.onGround}`);
    console.log(`  standing on: ${under || '(nothing — fell out of the room)'}`
      + (def ? `  solid=${!!def.solid} oneWay=${!!def.oneWay}` : ''));
    return;
  }

  if (cmd === 'trace') {
    const [room, x, y, keys, frames = '30'] = args;
    if (!room || x === undefined || y === undefined) usage();
    const down = !keys || keys === '-' ? [] : keys.split(',');
    const { harness, game } = await bootGame();
    harness.beginRun({ kind: 'scenario', scenario: { room, quiet: true, player: { x: Number(x), y: Number(y) } } });
    harness.step([], 2);
    console.log(`${room}: [${down.join(',') || 'no input'}] for ${frames} frames`);
    for (let f = 1; f <= Number(frames); f++) {
      harness.step(down, 1);
      console.log(`  f${String(f).padStart(3)} ${fmt(playerRow(game))}`);
    }
    return;
  }

  if (cmd === 'roundtrip') {
    const [room, x, y, dir] = args;
    if (!room || !dir) usage();
    const back = dir === 'left' ? 'right' : 'left';
    const { harness, game } = await bootGame();
    harness.beginRun({ kind: 'scenario', scenario: { room, quiet: true, player: { x: Number(x), y: Number(y) } } });
    harness.step([], 90);
    const walkUntilRoomChanges = (d) => {
      const from = playerRow(game).room;
      for (let f = 0; f < 600; f++) {
        harness.step([d], 1);
        if (playerRow(game).room !== from) { harness.step([], 90); return true; }
      }
      return false;
    };
    const a = playerRow(game);
    console.log(`A   ${fmt(a)}`);
    if (!walkUntilRoomChanges(dir)) { console.log(`never crossed walking ${dir}`); process.exitCode = 1; return; }
    const b = playerRow(game);
    console.log(`B   ${fmt(b)}`);
    if (!walkUntilRoomChanges(back)) { console.log(`never crossed back walking ${back}`); process.exitCode = 1; return; }
    const a2 = playerRow(game);
    console.log(`A'  ${fmt(a2)}`);
    const same = a2.room === a.room && Math.abs(a2.y - a.y) < 0.01;
    console.log(`\na.y=${a.y.toFixed(1)}  a'.y=${a2.y.toFixed(1)}  `
      + (same ? 'IDENTITY — the doorway is reversible'
        : `MISMATCH of ${(a2.y - a.y).toFixed(1)}px — a walk through this seam is not reversible`));
    if (!same) process.exitCode = 1;
    return;
  }

  if (cmd === 'replay') {
    const [file] = args;
    if (!file) usage();
    // Accepts either a raw recording or a bug tape, which wraps one
    // alongside its issue text and expectations.
    const raw = JSON.parse(readFileSync(file, 'utf8'));
    const rec = raw.recording ?? raw;
    const { harness, game } = await bootGame({ storage: rec.storage });
    const t0 = Date.now();
    harness.replayRun(rec);
    const rooms = [];
    let bad = 0;
    const wanted = new Map(rec.checks ?? []);
    const sampler = makeSampler();
    for (let f = 1; f <= rec.end; f++) {
      harness.runTo(f);
      const r = playerRow(game);
      sampler.sample(r);
      if (r && rooms[rooms.length - 1] !== r.room) rooms.push(r.room);
      if (wanted.has(f) && harness.hashNow() !== wanted.get(f)) bad++;
    }
    const stats = sampler.result;
    console.log(`${file}: ${rec.end} steps in ${Date.now() - t0}ms`);
    console.log(`  journey: ${rooms.join(' > ')}`);
    console.log(`  end:     ${fmt(playerRow(game))}`);
    if (raw.recording) {
      // A BUG tape. Its recording was captured on the broken build, so its
      // hashes are supposed to differ now — that is what fixing the bug
      // means. The tape asserts semantics instead; check those.
      // Every expectation the tape carries, on bugtest.mjs's terms — the
      // transient ones included, since those are the whole reason a bug
      // tape exists rather than an end-state assertion.
      const want = raw.expect ?? {};
      const end = playerRow(game);
      const fails = [];
      if (want.rooms && want.rooms.join('>') !== rooms.join('>')) {
        fails.push(`journey ${rooms.join(' > ')} != expected ${want.rooms.join(' > ')}`);
      }
      if (want.inBounds && stats.outOfBounds) fails.push(`left the world at ${stats.outOfBounds}`);
      if (want.maxWarp != null && stats.maxWarp > want.maxWarp) {
        fails.push(`same-room warp of ${stats.maxWarp.toFixed(1)}px (allowed ${want.maxWarp})`);
      }
      if (want.end?.room && end?.room !== want.end.room) {
        fails.push(`ends in ${end?.room}, expected ${want.end.room}`);
      }
      if (want.end?.y != null && end && Math.abs(end.y - want.end.y) > (want.end.tolerance ?? 8)) {
        fails.push(`ends at y=${Math.round(end.y)}, expected ~${want.end.y}`);
      }
      console.log(`  worst:   ${stats.maxWarp.toFixed(1)}px same-room step`
        + `, ${stats.outOfBounds ? 'LEFT THE WORLD at ' + stats.outOfBounds : 'stayed in bounds'}`);
      console.log(fails.length ? `  FAILED:  ${fails.join('; ')}` : '  expects: all ok');
      console.log('  (hashes not compared: a bug tape was recorded on the broken build)');
      if (fails.length) process.exitCode = 1;
      return;
    }
    console.log(`  hashes:  ${(rec.checks?.length ?? 0) - bad}/${rec.checks?.length ?? 0} matched`
      + (bad ? '  (DIVERGED from the recording)' : ''));
    if (bad) process.exitCode = 1;
    return;
  }

  usage();
}

const [cmd, ...args] = process.argv.slice(2);
const usage = () => {
  console.error(
    'usage:\n'
    + '  browser (needs npm run dev):\n'
    + '    inspect.mjs grid <room> [c0 c1 r0 r1]\n'
    + '    inspect.mjs doors <room>\n'
    + '    inspect.mjs shot <room> <x> <y> [out.png] [r] [scale]\n'
    + '    inspect.mjs cross <room> <x> <y> <left|right> [frames]\n'
    + '  headless (no browser, no dev server — prefer these):\n'
    + '    inspect.mjs drop <room> <x> <y> [w h]\n'
    + '    inspect.mjs trace <room> <x> <y> <keys|-> <frames>\n'
    + '    inspect.mjs roundtrip <room> <x> <y> <left|right>\n'
    + '    inspect.mjs replay <recording.json>',
  );
  process.exit(2);
};
if (!cmd) usage();

// The headless verbs answer geometry and physics questions from the
// game's own modules in Node — no page, no dev server, ~0.6s instead of
// a browser session. They dispatch before the browser is ever launched.
if (HEADLESS.has(cmd)) {
  await runHeadless(cmd, args, usage);
  await closeHeadless();
  // The vite server keeps the event loop alive, so the exit has to be
  // explicit — but it must carry the verdict. `process.exit(0)` here
  // turned every MISMATCH and DIVERGED into a green exit status, which
  // is the one defect a verification tool must never have: a check that
  // cannot fail is not a check.
  process.exit(process.exitCode ?? 0);
}

const browser = await launchBrowser();
const { page, errors } = await openSession(browser, 7);
let code = 0;

try {
  switch (cmd) {
    case 'grid': {
      const [room, ...rg] = args;
      if (!room) usage();
      const range = rg.length === 4 ? rg.map(Number) : null;
      const g = await tileGrid(page, room, range);
      console.log(`${g.room}  ${g.cols}x${g.rows} tiles  showing cols ${g.range[0]}-${g.range[1]} rows ${g.range[2]}-${g.range[3]}`);
      console.log(`legend: ${g.legend.join('  ')}`);
      g.grid.forEach((line, i) => console.log(`r${String(g.range[2] + i).padStart(2)} ${line}`));
      break;
    }
    case 'doors': {
      const [room] = args;
      if (!room) usage();
      for (const d of await doorReport(page, room)) {
        const props = Object.keys(d.props).length ? `  props=${JSON.stringify(d.props)}` : '';
        const under = d.tilesUnder.length ? d.tilesUnder.join(',') : 'bare air';
        console.log(`-> ${d.to}  cols ${d.cols[0]}-${d.cols[1]} rows ${d.rows[0]}-${d.rows[1]}  fires: ${d.fires}${props}  tiles under: ${under}`);
      }
      break;
    }
    case 'shot': {
      const [room, x, y, out = 'inspect-shot.png', r = '80', scale = '2'] = args;
      if (!room || x === undefined || y === undefined) usage();
      await beginScenario(page, { room, quiet: true, player: { x: Number(x), y: Number(y) } });
      await step(page, [], 20); // let door-opening art, banners etc. settle
      const buf = await snapWorld(page, { at: 'player', r: Number(r), scale: Number(scale) });
      writeFileSync(out, buf);
      console.log(`wrote ${out} (${buf.length} bytes, ${Number(r) * 2} world px square)`);
      break;
    }
    case 'cross': {
      const [room, x, y, dir, frames = '120'] = args;
      if (!room || !dir) usage();
      await beginScenario(page, { room, quiet: true, player: { x: Number(x), y: Number(y) } });
      const before = await state(page);
      const after = await step(page, [dir], Number(frames));
      const crossed = before.roomId !== after.roomId;
      console.log(
        `${before.roomId} (x=${before.player.x}, y=${before.player.y}) --${dir} ${frames}f--> `
        + `${after.roomId} (x=${after.player.x}, y=${after.player.y})  ${crossed ? 'CROSSED' : 'STAYED'}`,
      );
      break;
    }
    default:
      usage();
  }
  if (errors.length) {
    console.error('page errors:', errors);
    code = 1;
  }
} catch (err) {
  console.error(String(err?.message ?? err));
  code = 1;
} finally {
  await browser.close();
}
process.exit(code);
