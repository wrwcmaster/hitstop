/**
 * Re-record the tutorial-course fixture: a full play of the training
 * yard from a genuine NEW GAME, ending one step into the Old Mill Road.
 *
 *   node tools/agent-play/record-tutorial.mjs
 *
 * A tool for the same reason record-kingsroad.mjs is: the tape's final
 * checkpoints hash the kingsroad ENTRY, so any change to that room —
 * even a moved chest — invalidates it, and it was hand-re-recorded six
 * times before this file existed. The run does everything the yard
 * teaches: takes the sword from the veteran, equips it through the real
 * pause menu, breaks the dummies, dashes the spiked gaps, snipes the
 * far dummy with the fireball, loots the caches, kills the penned slime
 * by fire, and walks out the exit.
 *
 * The artifact is interrogated before writing: genuine
 * {kind:'new', tutorial:true} start, skill press on the tape, alive,
 * ending in kingsroad.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bootGame, close } from './headless.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(here, 'recordings', 'tutorial-course.json');

const { harness, game } = await bootGame({ fresh: true, seed: 20260804 });
const play = () => game.scenes.all().find((s) => s.constructor.name === 'PlayScene');
const P = () => play().player;
const ui = () => globalThis.window.__observe()?.ui;
const step = (keys, n) => { harness.step(keys, n); let g = 0; while (ui()?.blocking && g++ < 24) { harness.step(['confirm'], 3); harness.step([], 5); } };
const walkTo = (x, cap = 2000) => { let n = 0, lastX = P().x, stall = 0; while (Math.abs(P().x - x) > 4 && n++ < cap) { const dir = P().x < x ? 'right' : 'left'; step([dir], 2); if (Math.abs(P().x - lastX) < 0.5) { if (++stall > 4) { step([dir, 'jump'], 10); step([dir], 8); stall = 0; } } else stall = 0; lastX = P().x; } };
const settle = () => { let n = 0; while (!P().onGround && n++ < 240) step([], 1); };
const gap = (lip) => { walkTo(lip - 42); step(['right'], 12); step(['right', 'jump'], 9); step(['right', 'dash'], 6); step(['right'], 2); settle(); };

harness.beginRun({ kind: 'new', tutorial: true });
step([], 30);
walkTo(170); harness.step(['interact'], 4); harness.step([], 6);
let g = 0; while (ui()?.blocking && g++ < 24) { harness.step(['confirm'], 3); harness.step([], 6); }
harness.step(['menu'], 3); harness.step([], 8);
let d = ui();
const invIdx = d.options.indexOf('INVENTORY');
for (let i = 0; i < invIdx; i++) { harness.step(['down'], 2); harness.step([], 4); }
harness.step(['confirm'], 3); harness.step([], 8);
d = ui();
const swordIdx = d.options.findIndex((o) => /RUSTY/i.test(o));
for (let i = 0; i < swordIdx; i++) { harness.step(['down'], 2); harness.step([], 4); }
harness.step(['confirm'], 3); harness.step([], 8);
harness.step(['menu'], 3); harness.step([], 6);
harness.step(['menu'], 3); harness.step([], 6);
walkTo(272);
let n = 0;
while (game.world.all().some((e) => e.type === 'dummy' && !e.dead && e.x < 400) && n++ < 60) {
  const dm = game.world.all().find((e) => e.type === 'dummy' && !e.dead && e.x < 400);
  walkTo(dm.x - 14, 200); step(['attack'], 4); step([], 14);
}
gap(496); gap(608);
walkTo(700); step(['right'], 2); harness.step(['skill'], 4); step([], 100);
gap(720);
n = 0;
while (game.world.all().some((e) => e.type === 'healing-chest' && !e.dead) && n++ < 40) {
  const c = game.world.all().find((e) => e.type === 'healing-chest' && !e.dead);
  const dir = P().x < c.x - 14 ? 'right' : P().x > c.x + 14 ? 'left' : null;
  if (dir) step([dir], 3); else { step(['attack'], 4); step([], 14); }
}
walkTo(850); walkTo(920); walkTo(930);
step(['right'], 6); step(['right', 'jump'], 12); step(['right'], 28); settle();
n = 0;
while (game.world.all().some((e) => e.type === 'slime' && !e.dead) && n++ < 12) {
  const sl = game.world.all().find((e) => e.type === 'slime' && !e.dead);
  if (sl.x > P().x !== (P().facing > 0)) step([sl.x > P().x ? 'right' : 'left'], 2);
  harness.step(['skill'], 4);
  step([], 80);
}
n = 0; while (harness.state().roomId === 'tutorial' && n++ < 800) step(['right'], 4);
step([], 40);
const rec = globalThis.window.__harness.recording();
const good = rec.start.kind === 'new' && rec.start.tutorial === true
  && rec.tape.some((e) => e[2] === 'skill') && harness.state().roomId === 'kingsroad' && P().hp > 0;
if (good) {
  fs.writeFileSync(OUT, JSON.stringify(rec));
  console.log('tutorial-course recorded:', rec.end, 'steps, hp', P().hp, '->', path.basename(OUT));
  await close();
  process.exit(0);
}
console.error('run did not qualify: room', harness.state().roomId, 'start', JSON.stringify(rec.start), 'hp', P()?.hp);
await close();
process.exit(1);
