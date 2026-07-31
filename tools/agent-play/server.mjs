/**
 * HTTP bridge so an LLM agent (or curl) can play hitstop turn-based.
 *
 *   node tools/agent-play/server.mjs        # no browser, no dev server
 *
 * The simulation runs in THIS process (see headless.mjs), so a turn costs
 * ~0.8ms and the whole bill is the agent's own thinking. It used to drive
 * a Playwright page, which bought nothing here: the sim is deterministic
 * and headless, and only pixels need a canvas.
 *
 * Endpoints (JSON in/out):
 *   POST /session    {seed?, scenario?, look?}  → fresh deterministic session
 *   POST /scenario   {room|roomDef, player?, spawn?}  → restart into a scenario
 *   POST /step       {down?: string[], frames?, look?} → play, get state
 *   GET  /state                             → current state, no time passes
 *   GET  /look       ?r=&rows=              → local geometry as ASCII (cheap)
 *   GET  /tiles      ?room=&c0=&c1=&r0=&r1= → a room's tilemap as ASCII
 *   GET  /snapshot                          → the live moment as a TestScenario
 *   GET  /recording                         → the session's replayable log
 *   POST /save       {name?}                → write recording to recordings/
 *   POST /shutdown                          → exit
 *
 * `look: true` on /session, /scenario and /step returns the view WITH the
 * state, so seeing what is ahead costs an agent no extra round trip —
 * about 75 tokens of ASCII rather than a screenshot's thousand.
 *
 * Pixels are the one thing this cannot serve: a headless session has no
 * canvas. For a visual check use `inspect.mjs shot <room> <x> <y>`, which
 * opens its own browser for the purpose.
 *
 * The whole session is recorded; POST /save it and re-run with
 * `npm run replay:headless` to verify it reproduces bit-for-bit.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bootGame, lookAround, dynamicSolidCells, close } from './headless.mjs';

const PORT = Number(process.env.AGENT_PLAY_PORT ?? 8791);
const here = path.dirname(fileURLToPath(import.meta.url));
const recDir = path.join(here, 'recordings');

/** The one live game. `tiles` is the registry the view reads flags from. */
let sess = null;
let booted = false;

async function newSession(seed) {
  // A second session gets a fresh module graph, which is the isolation a
  // new browser page used to provide. The first needs no such reset.
  //
  // The localStorage stand-in is NOT part of that module graph — it hangs
  // off globalThis and outlives every reset — so a session that autosaved
  // would hand its `hitstop.save` and settings to the next one, and
  // /session is documented as fresh. An empty snapshot is what a new
  // browser context used to give for free.
  sess = await bootGame({ fresh: booted, seed, storage: {} });
  booted = true;
  const engine = await sess.server.ssrLoadModule('/src/engine/index.ts');
  sess.tiles = engine.tiles;
  sess.ROOMS = (await sess.server.ssrLoadModule('/src/game/content/rooms/index.ts')).ROOMS;
  sess.buildTilemap = engine.buildTilemap;
  sess.openEdgeDoorways = (await sess.server.ssrLoadModule('/src/game/scenes/play/doorways.ts')).openEdgeDoorways;
  return sess;
}

function need() {
  if (!sess) throw new Error('no session — POST /session first');
  return sess;
}

/** Attach the local view when the caller asked for one. */
function withLook(st, body, q, first = false) {
  const out = { ...st, ...perception(body, q, first) };
  const want = body?.look ?? (q && q.get('look') === '1');
  if (!want) return out;
  const view = lookAround(sess.game, {
    r: Number(body?.r ?? q?.get('r') ?? 10),
    rows: Number(body?.rows ?? q?.get('rows') ?? 7),
    tiles: sess.tiles,
  });
  return { ...out, view };
}

/**
 * The rich observation, on every reply the bridge sends.
 *
 * `harness.state()` is the replay divergence hash — positions and hit
 * points, because that is what determinism needs to compare. An agent
 * needs velocities, reach, projectiles and, above all, THE SCREEN, and
 * for a while it could only get those in-process: an agent driving the
 * documented HTTP bridge received exactly the old positions-only state
 * and would still freeze in front of an "Equip this?" panel it had no
 * way to know was there.
 *
 * On by default rather than behind a flag, because "you had to know to
 * ask" is the same bug in a new place. `see: false` opts out for a
 * caller that wants the smaller payload.
 */
function perception(body, q, first = false) {
  const off = body?.see === false || q?.get('see') === '0';
  const observe = globalThis.window?.__observe;
  if (off || typeof observe !== 'function') return {};
  const o = observe();
  if (!o) return {};
  // `ui` is hoisted out of `see` and always sent: it is two fields, and
  // it is the one that decides whether any of the others matter.
  const { ui, ...rest } = o;
  // The action list never changes for the length of a session, so it
  // goes out once with the session and never again. Sixteen fixed
  // strings repeated on every step is the kind of waste that is
  // invisible per-frame and enormous over a run.
  if (!first && rest.abilities) {
    const { actions, ...live } = rest.abilities;
    rest.abilities = live;
  }
  return { ui, see: rest };
}

/** A room's whole tilemap as ASCII — the structural question, not the local one. */
function tileGrid(roomId, range) {
  const s = need();
  const room = roomId ? s.ROOMS[roomId] : null;
  if (roomId && !room) throw new Error(`no such room "${roomId}"`);
  let map;
  if (room) {
    map = s.buildTilemap(room);
    // Doorway geometry is DERIVED, not authored: every room load recreates
    // it (PlayScene.setRoom, collisionMapFor, the guest scene, lib.mjs and
    // sweep.mjs all do). Reading a room without it reports solid stone
    // where the game has an open threshold, so a structural probe decides
    // a door is walled off — the exact wrong answer to the exact question
    // this endpoint exists to answer.
    s.openEdgeDoorways(room, map);
  } else {
    map = s.game.scenes.all().find((x) => x.constructor.name === 'PlayScene')?.tilemap;
  }
  if (!map) throw new Error('no room to read');
  // Only the live map has gizmos in it; a freshly built room has none.
  const dyn = dynamicSolidCells(map);
  const [c0, c1, r0, r1] = range ?? [0, map.cols - 1, 0, map.rows - 1];
  const rows = [];
  for (let r = Math.max(0, r0); r <= Math.min(map.rows - 1, r1); r++) {
    let line = '';
    for (let c = Math.max(0, c0); c <= Math.min(map.cols - 1, c1); c++) {
      const moving = dyn.get(`${c},${r}`);
      if (moving) { line += moving; continue; }
      const id = map.tileAt(c, r);
      if (!id) { line += '.'; continue; }
      const d = s.tiles.get(id);
      line += d.hazard ? '^' : d.water ? '~' : (d.solid && !d.oneWay) ? '#' : (d.solid || d.oneWay) ? '-' : ',';
    }
    rows.push(line);
  }
  return {
    room: roomId ?? 'live', cols: map.cols, rows: map.rows,
    range: [Math.max(0, c0), Math.min(map.cols - 1, c1), Math.max(0, r0), Math.min(map.rows - 1, r1)],
    legend: '# solid, - platform, = moving platform or closed barrier (this frame), '
      + '^ hazard, ~ water, . air, , decor',
    grid: rows,
  };
}

/** The live moment as a re-enterable TestScenario. */
function snapshot() {
  const s = need();
  const play = s.game.scenes.all().find((x) => x.constructor.name === 'PlayScene');
  const p = play?.player;
  if (!p) throw new Error('no run in progress — nothing to snapshot');
  const st = s.harness.state();
  // Subtract the room's own entities by type: setRoom respawns those, so
  // carrying them in `spawn` would double them on re-entry.
  const live = [...st.monsters];
  const deadAuthored = [];
  for (const e of s.ROOMS[st.roomId]?.entities ?? []) {
    const i = live.findIndex((m) => m.type === e.type);
    if (i >= 0) live.splice(i, 1);
    else deadAuthored.push(e.type);
  }
  const scenario = {
    room: st.roomId,
    quiet: true,
    player: {
      x: Math.round(st.player.x), y: Math.round(st.player.y),
      hp: p.hp, gold: p.gold,
      give: p.inventory.slots.flatMap((sl) => Array(sl.count ?? 1).fill(sl.id)),
      equip: p.equipment.slots().map(([, id]) => id),
      earned: p.earned.list(),
    },
    spawn: live.map((m) => ({ type: m.type, x: Math.round(m.x), y: Math.round(m.y) })),
  };
  if (!scenario.spawn.length) delete scenario.spawn;
  const out = { scenario };
  if (deadAuthored.length) out.deadAuthored = deadAuthored;
  const prog = p.progression.snapshot();
  const skills = [...p.skills.known];
  if (p.classId !== 'knight' || prog.level > 1 || skills.length) {
    out.dropped = { classId: p.classId, level: prog.level, skills };
  }
  return out;
}

async function handle(req, res, body) {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const q = url.searchParams;
  switch (`${req.method} ${url.pathname}`) {
    case 'POST /session': {
      const seed = Number(body.seed ?? 1) >>> 0 || 1;
      const s = await newSession(seed);
      const st = body.scenario
        ? s.harness.beginRun({ kind: 'scenario', scenario: body.scenario })
        : s.harness.state();
      return { seed, state: withLook(st, body, q, true) };
    }
    case 'POST /scenario': {
      const s = need();
      return withLook(s.harness.beginRun({ kind: 'scenario', scenario: body }), body, q);
    }
    case 'POST /step': {
      const s = need();
      const down = Array.isArray(body.down) ? body.down : [];
      return withLook(s.harness.step(down, Number(body.frames ?? 1)), body, q);
    }
    case 'GET /state':
      return withLook(need().harness.state(), null, q);
    case 'GET /look': {
      const s = need();
      const view = lookAround(s.game, {
        r: Number(q.get('r') ?? 10), rows: Number(q.get('rows') ?? 7), tiles: s.tiles,
      });
      if (!view) throw new Error('no run in progress — nothing to look at');
      return view;
    }
    case 'GET /tiles': {
      const range = ['c0', 'c1', 'r0', 'r1'].every((k) => q.has(k))
        ? ['c0', 'c1', 'r0', 'r1'].map((k) => Number(q.get(k)))
        : null;
      return tileGrid(q.get('room'), range);
    }
    case 'GET /screenshot':
      throw new Error(
        'this bridge is headless and has no canvas. For pixels use '
        + '`node tools/agent-play/inspect.mjs shot <room> <x> <y> out.png`, '
        + 'or GET /look for the same question as text.',
      );
    case 'GET /snapshot':
      return snapshot();
    case 'GET /recording':
      return need().harness.recording();
    case 'POST /save': {
      const rec = need().harness.recording();
      if (!rec) throw new Error('no run started yet — recordings are per-run');
      const name = String(body.name ?? `run-${rec.seed}-${Date.now()}`).replace(/[^\w.-]/g, '_');
      fs.mkdirSync(recDir, { recursive: true });
      const file = path.join(recDir, name.endsWith('.json') ? name : `${name}.json`);
      fs.writeFileSync(file, JSON.stringify(rec));
      return { saved: file, inputs: rec.tape.length, steps: rec.end, seed: rec.seed };
    }
    case 'POST /shutdown':
      setTimeout(async () => { await close().catch(() => {}); process.exit(0); }, 50);
      return { bye: true };
    default:
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `no route ${req.method} ${url.pathname}` }));
      return null;
  }
}

http
  .createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', async () => {
      let body = {};
      try {
        if (chunks.length) body = JSON.parse(Buffer.concat(chunks).toString());
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'bad JSON body' }));
      }
      try {
        const out = await handle(req, res, body);
        if (out !== null) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(out));
        }
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: String(err?.message ?? err) }));
      }
    });
  })
  .listen(PORT, () => console.log(`agent-play bridge on http://localhost:${PORT} (headless — no browser, no dev server)`));
