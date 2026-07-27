/**
 * Shared Playwright plumbing for the agent-play bridge and replay runner.
 *
 * Browser resolution order:
 *   PW_EXECUTABLE (explicit path) → PW_CHANNEL (e.g. msedge/chrome) →
 *   bundled chromium → msedge channel fallback (Windows dev boxes).
 */
import { chromium } from 'playwright';

export const GAME_URL = process.env.HITSTOP_URL ?? 'http://localhost:5173/';

export async function launchBrowser() {
  const opts = { headless: true, args: ['--autoplay-policy=no-user-gesture-required'] };
  if (process.env.PW_EXECUTABLE) {
    return chromium.launch({ ...opts, executablePath: process.env.PW_EXECUTABLE });
  }
  if (process.env.PW_CHANNEL) {
    return chromium.launch({ ...opts, channel: process.env.PW_CHANNEL });
  }
  try {
    return await chromium.launch(opts);
  } catch {
    return chromium.launch({ ...opts, channel: 'msedge' });
  }
}

/**
 * Open a fresh harness session: new context (clean localStorage — nothing
 * leaks between runs), optionally pre-seeded with a recording's boot-time
 * storage (saves/settings), navigate with ?harness=1&seed=N, wait for the
 * page to expose __harness.
 */
export async function openSession(browser, seed, { baseUrl = GAME_URL, storage = {} } = {}) {
  const context = await browser.newContext({ viewport: { width: 960, height: 540 } });
  if (Object.keys(storage).length) {
    await context.addInitScript((entries) => {
      for (const [k, v] of Object.entries(entries)) localStorage.setItem(k, v);
    }, storage);
  }
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (err) => errors.push(String(err)));
  const url = new URL(baseUrl);
  url.searchParams.set('harness', '1');
  url.searchParams.set('seed', String(seed));
  await page.goto(url.toString(), { waitUntil: 'load' });
  await page.waitForFunction(() => !!window.__harness, null, { timeout: 15000 });
  return { context, page, errors, seed };
}

/** Hold exactly `down` for `frames` fixed steps; returns the resulting state. */
export function step(page, down = [], frames = 1) {
  return page.evaluate(([d, n]) => window.__harness.step(d, n), [down, frames]);
}

export function state(page) {
  return page.evaluate(() => window.__harness.state());
}

export function recording(page) {
  return page.evaluate(() => window.__harness.recording());
}

/** Begin a test scenario and settle two steps so the world exists. */
export async function beginScenario(page, scenario) {
  await page.evaluate(
    (sc) => window.__harness.beginRun({ kind: 'scenario', scenario: sc }),
    scenario,
  );
  return step(page, [], 2);
}

/**
 * The room as the game actually resolves it, as text: an ASCII grid in
 * the room's own legend characters, with runtime-inserted tiles (doorway
 * backing, mutations) picked up under fallback characters and every
 * character explained in the returned legend.
 *
 * This is the cheap end of the probe spectrum — a structural question
 * ("is the door in the wall?", "what's behind the threshold?") answered
 * for ~a hundred tokens instead of a screenshot's ~thousand.
 *
 * `room` names a registered id (resolved fresh through the same
 * buildTilemap + openEdgeDoorways the game uses); null reads the LIVE
 * room of a run in progress, patches and all.
 */
export function tileGrid(page, room = null, range = null) {
  return page.evaluate(async ([id, rg]) => {
    const eng = await import('/src/engine/index.ts');
    const { ROOMS } = await import('/src/game/content/rooms/index.ts');
    let map;
    let def;
    if (id) {
      def = ROOMS[id];
      if (!def) throw new Error(`no room "${id}" — have: ${Object.keys(ROOMS).join(', ')}`);
      const { openEdgeDoorways } = await import('/src/game/scenes/play/doorways.ts');
      map = eng.buildTilemap(def);
      openEdgeDoorways(def, map);
    } else {
      const sc = window.hitstop.scenes.all().find((s) => s.constructor.name === 'PlayScene');
      if (!sc?.tilemap) throw new Error('no live room — pass a room id or start a run');
      map = sc.tilemap;
      def = sc.room;
    }
    const charOf = new Map(Object.entries(def.legend ?? {}).map(([ch, tid]) => [tid, ch]));
    const used = new Set([...charOf.values(), '.']);
    const pool = [...'0123456789*+&@!?<>%~^'].filter((ch) => !used.has(ch));
    const rows = [];
    const [c0, c1, r0, r1] = rg ?? [0, map.cols - 1, 0, map.rows - 1];
    for (let ty = r0; ty <= r1; ty++) {
      let line = '';
      for (let tx = c0; tx <= c1; tx++) {
        const tid = map.tileAt(tx, ty);
        if (!tid) {
          line += '.';
          continue;
        }
        if (!charOf.has(tid)) charOf.set(tid, pool.shift() ?? '?');
        line += charOf.get(tid);
      }
      rows.push(line);
    }
    const legend = [...charOf].map(
      ([tid, ch]) => `${ch}=${tid}${eng.tiles.get(tid).solid ? '(solid)' : ''}`,
    );
    return { room: id ?? def.name, cols: map.cols, rows: map.rows, range: [c0, c1, r0, r1], legend, grid: rows };
  }, [room, range]);
}

/**
 * Every door trigger of a room, as facts: destination, tile footprint,
 * which edge rule fires it, its lock props, and the resolved tiles under
 * it (empty means bare air — a doorway with nothing drawn in it).
 */
export function doorReport(page, room) {
  return page.evaluate(async (id) => {
    const eng = await import('/src/engine/index.ts');
    const { ROOMS } = await import('/src/game/content/rooms/index.ts');
    const { edgeDoorSide, openEdgeDoorways } = await import('/src/game/scenes/play/doorways.ts');
    const def = ROOMS[id];
    if (!def) throw new Error(`no room "${id}" — have: ${Object.keys(ROOMS).join(', ')}`);
    const map = eng.buildTilemap(def);
    openEdgeDoorways(def, map);
    const ts = def.tileSize;
    return (def.triggers ?? [])
      .filter((t) => t.event === 'door')
      .map((t) => {
        const c0 = Math.floor(t.x / ts);
        const c1 = Math.floor((t.x + t.w - 1) / ts);
        const r0 = Math.floor(t.y / ts);
        const r1 = Math.floor((t.y + t.h - 1) / ts);
        const under = new Set();
        for (let r = r0; r <= r1; r++) {
          for (let c = c0; c <= c1; c++) {
            const tid = map.tileAt(c, r);
            if (tid) under.add(tid);
          }
        }
        const side = edgeDoorSide(def, t);
        const { room: to, ...props } = t.props ?? {};
        return {
          to,
          cols: [c0, c1],
          rows: [r0, r1],
          fires: side === -1 ? 'left edge, walk-through'
            : side === 1 ? 'right edge, walk-through'
            : t.props?.fallIn ? 'fall-in seam'
            : t.props?.leapUp ? 'leap-up seam'
            : 'interior, press E',
          props,
          tilesUnder: [...under],
        };
      });
  }, room);
}

/**
 * Freeze the live moment as a TestScenario: room, the knight's position
 * and kit, and every monster the ROOM ITSELF won't respawn, carried as
 * `spawn` entries at their live positions. POST the result to /scenario
 * (or feed it to beginScenario) to re-enter an equivalent situation.
 *
 * Equivalent, not bit-exact — that's the recording's job. Two honest
 * gaps, reported rather than hidden: a room's authored entities respawn
 * fresh at their authored spots (a moved boss re-enters at home; a dead
 * one comes back — `deadAuthored` lists those), and TestScenario has no
 * fields for progression/skills/class (`dropped` carries what was lost).
 */
export function snapshotScenario(page) {
  return page.evaluate(async () => {
    const { ROOMS } = await import('/src/game/content/rooms/index.ts');
    const sc = window.hitstop.scenes.all().find((s) => s.constructor.name === 'PlayScene');
    const p = sc?.player;
    if (!p) throw new Error('no run in progress — nothing to snapshot');
    const st = window.__harness.state();

    // Subtract the room's own entities by type: setRoom respawns those,
    // so carrying them in `spawn` would double them on re-entry.
    const live = [...st.monsters];
    const deadAuthored = [];
    for (const e of ROOMS[st.roomId]?.entities ?? []) {
      const i = live.findIndex((m) => m.type === e.type);
      if (i >= 0) live.splice(i, 1);
      else deadAuthored.push(e.type);
    }

    const scenario = {
      room: st.roomId,
      quiet: true,
      player: {
        x: Math.round(st.player.x),
        y: Math.round(st.player.y),
        hp: p.hp,
        gold: p.gold,
        give: p.inventory.slots.flatMap((s) => Array(s.count ?? 1).fill(s.id)),
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
  });
}

/**
 * A small PNG of the world around a point, composed in-page at a fixed
 * output scale — so a probe image is a few hundred px on a side no
 * matter what the game's display zoom is. `at` is 'player' or {x, y} in
 * world px; `r` the world-px radius; `scale` output px per world px.
 */
export async function snapWorld(page, { at = 'player', r = 80, scale = 2 } = {}) {
  await page.evaluate(([where, rad, k]) => {
    const src = document.querySelector('canvas#game') ?? document.querySelector('canvas');
    const cam = window.hitstop.camera;
    let wx;
    let wy;
    if (where === 'player') {
      const p = window.__harness.state().player;
      if (!p) throw new Error("no player — start a run or pass {at: {x, y}}");
      wx = p.x;
      wy = p.y;
    } else {
      wx = where.x;
      wy = where.y;
    }
    const per = src.width / cam.viewW; // backing-store px per world px
    const sx = Math.round((wx - rad - cam.x) * per);
    const sy = Math.round((wy - rad - cam.y) * per);
    const s = Math.round(rad * 2 * per);
    const out = Math.round(rad * 2 * k);
    const dst = document.createElement('canvas');
    dst.width = out;
    dst.height = out;
    dst.id = '__snap';
    dst.style.cssText = 'position:fixed;left:0;top:0;z-index:99999;image-rendering:pixelated;background:#000';
    const g = dst.getContext('2d');
    g.imageSmoothingEnabled = false;
    g.drawImage(src, sx, sy, s, s, 0, 0, out, out);
    document.body.appendChild(dst);
  }, [at, r, scale]);
  const buf = await page.locator('#__snap').screenshot();
  await page.evaluate(() => document.getElementById('__snap')?.remove());
  return buf;
}
