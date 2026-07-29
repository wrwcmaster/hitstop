// Transition sweep (dev diagnostic, not CI): attempt every door in every
// room by its natural verb. Not part of npm test flows because a few
// passages legitimately need earned verbs or combat to approach — those
// are declared in VERB_GATED below and reported as skips.
//
//   node tools/agent-play/sweep.mjs      # needs npm run dev
//
// Verbs: edge doors walk and jump-cross; fall-ins drop through; leap-ups
// fire an injected full jump from inside the band; interior doors press
// interact immediately (a doorstep monster can shove the knight off an
// 8px trigger given a moment — which is a level-design observation, not
// a transition bug).
//
// Asserted per case: the target room is REACHED (a blocked-by-design far
// side may bounce you home — visiting counts), the landing stays in
// bounds, and locked doors refuse.
import { launchBrowser, openSession, beginScenario, step, state } from './lib.mjs';

const browser = await launchBrowser();
const { page } = await openSession(browser, 7);

const world = await page.evaluate(async () => {
  const eng = await import('/src/engine/index.ts');
  const { ROOMS } = await import('/src/game/content/rooms/index.ts');
  const { openEdgeDoorways, edgeDoorSide } = await import('/src/game/scenes/play/doorways.ts');
  const out = [];
  for (const [id, room] of Object.entries(ROOMS)) {
    if (id === 'test_room') continue;
    const map = eng.buildTilemap(room);
    openEdgeDoorways(room, map);
    const tileDef = (x, y) => {
      if (x < 0 || y < 0 || x >= map.worldW || y >= map.worldH) return null;
      const t = map.tileAt(Math.floor(x / 8), Math.floor(y / 8));
      return t === '' ? null : eng.tiles.get(t);
    };
    const solidAt = (x, y) => !!tileDef(x, y)?.solid;
    // One-way ledges are floors too — the mountain summit stands on one.
    const standableAt = (x, y) => { const d = tileDef(x, y); return !!(d && (d.solid || d.oneWay)); };
    // A standable placement: 14x18 body fully in open space, solid under
    // at least one foot. Scans down from yFrom at x.
    const standAt = (x, yFrom) => {
      outer: for (let y = Math.max(0, yFrom); y < map.worldH - 18; y += 2) {
        for (let by = y; by < y + 18; by += 6) {
          if (solidAt(x + 3, by) || solidAt(x + 11, by)) continue outer;
        }
        if (standableAt(x + 3, y + 19) || standableAt(x + 11, y + 19)) return y;
      }
      return null;
    };
    for (const tr of room.triggers ?? []) {
      if (tr.event !== 'door') continue;
      const locked = tr.props.key !== undefined || tr.props.flag !== undefined || tr.props.bossSeal !== undefined;
      const side = edgeDoorSide(room, tr);
      const kind = tr.props.fallIn ? 'fallIn' : tr.props.leapUp ? 'leapUp' : side !== null ? 'edge' : 'interior';
      const to = tr.props.room;
      if (kind === 'edge') {
        // Try a run of standing spots stepping away from the door; use
        // the first whose floor is level with the door band.
        let best = null;
        for (let d = 2; d <= 50 && !best; d += 4) {
          const x = side === -1 ? tr.x + tr.w + d : tr.x - 14 - d;
          const y = standAt(x, Math.max(0, tr.y - 12));
          if (y !== null && y + 18 <= tr.y + tr.h + 26) best = { x, y };
        }
        out.push({ room: id, to, kind, locked, ...(best ?? { x: -1, y: -1 }), wDir: side === -1 ? 'left' : 'right' });
      } else if (kind === 'fallIn') {
        out.push({ room: id, to, kind, locked, x: tr.x + tr.w / 2 - 7, y: Math.max(0, tr.y - 26) });
      } else if (kind === 'leapUp') {
        // Launch injected from just inside the band's lower half.
        out.push({ room: id, to, kind, locked, x: tr.x + tr.w / 2 - 7, y: tr.y + Math.max(2, tr.h - 12) });
      } else {
        const y = standAt(tr.x + tr.w / 2 - 7, tr.y);
        out.push({ room: id, to, kind, locked, x: tr.x + tr.w / 2 - 7, y: y ?? tr.y + tr.h - 18 });
      }
    }
  }
  return out;
});

// Passages whose approach needs a verb or dig this harness cannot
// perform; their seams are covered by the riven fixtures and bug tapes.
// `riven-lip>riven-descent` used to be listed here as "needs a wall-grip
// climb". It did not: the door was sealed behind a two-column gripstone
// wall and could not be entered at all. Gating a case the harness cannot
// perform is reasonable; gating one because it FAILED turns a bug into a
// skip, which is how that door stayed sealed. Only list a passage here
// when the approach provably needs a verb, and say which.
const VERB_GATED = {
  'underground>riven-lip': 'impact-drop dig through the cracked cap',
};

console.log(`${world.length} door cases\n`);
let bad = 0;
const notes = [];

async function run(c, label, fn) {
  const gated = VERB_GATED[c.room + '>' + c.to];
  if (gated) { notes.push(`gated ${c.room} -> ${c.to} (${gated}) — covered by fixtures`); return; }
  if (c.x < 0) { notes.push(`SKIP ${c.room} -> ${c.to} [${c.kind}] no standable approach found`); return; }
  await beginScenario(page, { room: c.room, quiet: true, player: { x: c.x, y: c.y } });
  if (c.kind === 'interior') await step(page, [], 3); // interact fast: doorstep monsters shove
  else if (c.kind !== 'leapUp') await step(page, [], 25);
  const visited = new Set([c.room]);
  const states = await fn();
  for (const s of states) visited.add(s.roomId);
  const last = states[states.length - 1];
  const dims = await page.evaluate(() => {
    const sc = window.hitstop.scenes.all().find((s) => s.constructor.name === 'PlayScene');
    return { w: sc.tilemap.worldW, h: sc.tilemap.worldH };
  });
  const p = last.player;
  const reached = visited.has(c.to);
  const inB = p.x > -26 && p.x < dims.w + 12 && p.y > -2 && p.y <= dims.h - 17;
  const ok = (c.locked ? !reached : reached) && inB;
  if (!ok) {
    bad++;
    console.log(`FAIL ${c.room} -> ${c.to} [${c.kind}${c.locked ? ' locked' : ''}] ${label}`);
    console.log(`   start(${c.x},${c.y}) visited=${[...visited].join(',')} end=${last.roomId}(${Math.round(p.x)},${Math.round(p.y)}) inBounds=${inB}`);
  }
}

const seq = async (...chunks) => {
  const out = [];
  for (const [keys, frames] of chunks) {
    for (let i = 0; i < frames; i += 5) out.push(await step(page, keys, Math.min(5, frames - i)));
  }
  return out;
};

for (const c of world) {
  if (c.kind === 'edge') {
    await run(c, 'walk', () => seq([[c.wDir], 110], [[], 40]));
    await run(c, 'jump-cross', () => seq([[c.wDir], 12], [[c.wDir, 'jump'], 20], [[c.wDir], 70], [[], 50]));
  } else if (c.kind === 'fallIn') {
    await run(c, 'drop', () => seq([['down'], 2], [['down', 'jump'], 3], [[], 90]));
  } else if (c.kind === 'leapUp') {
    await run(c, 'leap', async () => {
      await page.evaluate(([x, y]) => {
        const sc = window.hitstop.scenes.all().find((s) => s.constructor.name === 'PlayScene');
        sc.player.x = x; sc.player.y = y; sc.player.vy = -360;
      }, [c.x, c.y]);
      return seq([['jump'], 25], [[], 80]);
    });
  } else {
    await run(c, 'interact', () => seq([['interact'], 3], [[], 60]));
  }
}

for (const n of notes) console.log(n);
console.log(bad ? `\n${bad} failing case(s)` : '\nall door cases pass');
await browser.close();
process.exit(bad ? 1 : 0);
