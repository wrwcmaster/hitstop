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
import { writeFileSync } from 'node:fs';
import {
  launchBrowser, openSession, beginScenario, step, state,
  tileGrid, doorReport, snapWorld,
} from './lib.mjs';

const [cmd, ...args] = process.argv.slice(2);
const usage = () => {
  console.error(
    'usage:\n'
    + '  inspect.mjs grid <room> [c0 c1 r0 r1]\n'
    + '  inspect.mjs doors <room>\n'
    + '  inspect.mjs shot <room> <x> <y> [out.png] [r] [scale]\n'
    + '  inspect.mjs cross <room> <x> <y> <left|right> [frames]',
  );
  process.exit(2);
};
if (!cmd) usage();

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
