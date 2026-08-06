/**
 * Re-record the kingsroad-gate fixture: a scripted competent run of the
 * Old Mill Road + Gatehouse, saved only if it genuinely clears.
 *
 *   node tools/agent-play/record-kingsroad.mjs
 *
 * Exists as a tool because this tape sits downstream of MOST of the
 * game: swim tuning, monster balance, drop rules, room geometry — any
 * of them moving invalidates it, and tonight it was re-recorded seven
 * times from seven hand-rolled scripts. The run plays the level the way
 * it teaches you to: fireball the packs from range, swim the SURFACE
 * and dive only at the arches, climb the stairs deliberately, duel the
 * warden. Seeds are tried in order until one clears deathless.
 *
 * The artifact is interrogated before writing (scenario start, ends in
 * the cavern, alive) — three tapes this week captured post-death
 * autosave runs whose every "success" print was reading the wrong
 * world.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bootGame, close } from './headless.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(here, 'recordings', 'kingsroad-gate.json');

for (const seed of [33, 12, 21, 44, 55, 66, 77, 88, 99, 110]) {
  const { harness, game } = await bootGame({ fresh: true, seed });
  const play = () => game.scenes.all().find((s) => s.constructor.name === 'PlayScene');
  const P = () => play().player;
  const ui = () => globalThis.window.__observe()?.ui;
  const step = (keys, n) => { harness.step(keys, n); let g = 0; while (ui()?.blocking && g++ < 24) { harness.step(['confirm'], 3); harness.step([], 5); } };
  const walkTo = (x, cap = 2500) => { let n = 0, lastX = P().x, stall = 0; while (Math.abs(P().x - x) > 4 && n++ < cap) { const dir = P().x < x ? 'right' : 'left'; step([dir], 2); if (Math.abs(P().x - lastX) < 0.5) { if (++stall > 4) { step([dir, 'jump'], 10); step([dir], 8); stall = 0; } } else stall = 0; lastX = P().x; } };
  const settle = () => { let n = 0; while (!P().onGround && n++ < 240) step([], 1); };
  const alive = () => P() && P().hp > 0 && harness.state().roomId !== 'arena';
  const pitHop = (lip) => { for (let a = 0; a < 3; a++) { walkTo(lip - 16); step(['right'], 10); step(['right', 'jump'], 10); step(['right'], 14); settle(); if (P().y < 210) return; step(['left', 'jump'], 12); step(['left'], 6); settle(); } };
  const clearPack = (xLimit) => {
    for (let c = 0; c < 3; c++) {
      const s = game.world.all().find((e) => e.type === 'slime' && !e.dead && e.x < xLimit && e.x > P().x);
      if (!s || P().mp < 20) break;
      step(['right'], 2); harness.step(['skill'], 4); step([], 90);
    }
    let n = 0;
    while (n++ < 300 && alive()) {
      // knocked into a spike pit mid-fight: climb out east FIRST —
      // seed 33 died swinging its sword on the spikes of pit B
      if (P().y > 212 && P().onGround) { step(['jump'], 6); step(['right', 'jump'], 6); step(['right'], 8); settle(); continue; }
      // vertical filter: never chase foes on another storey (the cave
      // bats live 40px under the road — chasing their x walks the
      // recorder into the shaft)
      const foe = game.world.all().find((e) => ['slime', 'bat'].includes(e.type) && !e.dead && e.x < xLimit && Math.abs(e.x - P().x) < 90 && Math.abs(e.y - P().y) < 36);
      if (!foe) break;
      if (Math.abs(foe.x - P().x) < 26 && Math.abs(foe.y - P().y) < 26) { step(['attack'], 4); step([P().x < foe.x ? 'left' : 'right'], 5); }
      else if (Math.abs(foe.y - P().y) > 28 && Math.abs(foe.x - P().x) < 20) step(['jump', 'attack'], 6);
      else step([foe.x > P().x ? 'right' : 'left'], 3);
      step([], 5);
    }
  };
  harness.beginRun({ kind: 'scenario', scenario: { room: 'kingsroad', quiet: true, player: { x: 40, y: 190 } } });
  step([], 30);
  clearPack(340); pitHop(240); clearPack(430); pitHop(448); clearPack(520);
  // the hill: climb the mound, clear its garrison (slime + swooping
  // bat), then HOP the cave shaft at the east foot — falling in is
  // survivable (stall-hop escapes) but wastes tape
  walkTo(540); clearPack(640);
  walkTo(592); step(['right'], 4); step(['right', 'jump'], 11); step(['right'], 10); settle();
  if (P().y > 228) {
    // in the bat cave: fleeing while chewed costs ~40hp — kill the
    // nest first, then hop out
    let m = 0;
    while (m++ < 200 && alive()) {
      const b = game.world.all().find((e) => e.type === 'bat' && !e.dead && Math.abs(e.x - P().x) < 80 && e.y > 200);
      if (!b) break;
      if (Math.abs(b.x - P().x) < 24) { step(['attack'], 4); step([], 8); }
      else step([b.x > P().x ? 'right' : 'left'], 3);
    }
    walkTo(680);
  }
  clearPack(740);
  if (!alive()) { console.log('seed', seed, 'died on the road'); await close(); continue; }
  walkTo(752); step(['right'], 12);
  const swimTo = (until, dive) => { let n = 0; while (P().x < until && n++ < 400) step(dive ? ['right', 'down'] : ['right', 'jump'], 3); };
  swimTo(880, false); swimTo(925, true); swimTo(990, false); swimTo(1035, true); swimTo(1130, false);
  settle();
  if (!alive()) { console.log('seed', seed, 'died in the pond'); await close(); continue; }
  clearPack(1240);   // the millyard slime
  walkTo(1230);
  for (let s = 0; s < 12 && harness.state().roomId === 'kingsroad'; s++) {
    const bat = game.world.all().find((e) => e.type === 'bat' && !e.dead && Math.abs(e.x - P().x) < 40 && Math.abs(e.y - P().y) < 34);
    if (bat) { step(['attack'], 4); step([], 6); }
    step(['right', 'jump'], 7); step(['right'], 6); settle();
  }
  let n = 0, roofX = 0, roofStall = 0;
  while (harness.state().roomId === 'kingsroad' && n++ < 1200 && alive()) {
    // the wheel pit is the last gauntlet: two bats patrol the exit
    // stairs, and bobbing at the wall while they juggle you is death
    // (seed 33 bled 80hp doing exactly that). Once in the pit water,
    // commit: breach onto the first step, THEN fight up the stairs.
    if (P().x > 1590 && P().submersion > 0.2) {
      let w = 0;
      while (P().submersion > 0 && w++ < 200 && alive()) step(['right', 'jump'], 3);
      while (harness.state().roomId === 'kingsroad' && n++ < 1200 && alive()) {
        const b = game.world.all().find((e) => e.type === 'bat' && !e.dead && Math.abs(e.x - P().x) < 60 && Math.abs(e.y - P().y) < 60);
        if (b && Math.abs(b.x - P().x) < 32 && Math.abs(b.y - P().y) < 30) { step(['attack'], 4); step([], 6); }
        else if (b && b.y < P().y - 24 && Math.abs(b.x - P().x) < 24) { step(['jump', 'attack'], 8); step([], 6); }
        else { step(['right', 'jump'], 7); step(['right'], 6); settle(); }
        if (P().submersion > 0.2) break;   // knocked back in: re-breach
      }
      continue;
    }
    const bat = game.world.all().find((e) => e.type === 'bat' && !e.dead && Math.abs(e.x - P().x) < 42 && Math.abs(e.y - P().y) < 32);
    if (bat) { step(['attack'], 4); step([], 4); }
    // the mill's east end is the wheel pit: walk off the broken roof,
    // splash, surface-swim east (jump held = rise + auto-breach onto
    // the staircase), then stall-hop up to the door
    if (P().submersion > 0.2) step(['right', 'jump'], 3);
    else step(['right'], 3);
    if (Math.abs(P().x - roofX) < 0.5 && P().onGround) { if (++roofStall > 2) { step(['right', 'jump'], 8); step(['right'], 10); settle(); roofStall = 0; } } else roofStall = 0;
    roofX = P().x;
  }
  step([], 40);
  if (harness.state().roomId !== 'gatehouse') { console.log('seed', seed, 'lost on the rooftops'); await close(); continue; }
  // drink before the duel if the road has bled us — the play any
  // survivor makes, through the real pause menu
  if (P().hp < 70 && P().inventory.slots.some((sl) => sl.id === 'potion')) {
    harness.step(['menu'], 3); harness.step([], 8);
    let d = ui(); const inv = d.options.indexOf('INVENTORY');
    for (let i = 0; i < inv; i++) { harness.step(['down'], 2); harness.step([], 4); }
    harness.step(['confirm'], 3); harness.step([], 8);
    d = ui(); const pot = d.options.findIndex((o) => /POTION/i.test(o));
    for (let i = 0; i < pot; i++) { harness.step(['down'], 2); harness.step([], 4); }
    harness.step(['confirm'], 3); harness.step([], 8);
    harness.step(['menu'], 3); harness.step([], 6);
    harness.step(['menu'], 3); harness.step([], 6);
  }
  n = 0;
  while (game.world.all().some((e) => e.type === 'gate-brute' && !e.dead) && n++ < 700 && alive()) {
    const b = game.world.all().find((e) => e.type === 'gate-brute' && !e.dead);
    if (Math.abs(b.x - P().x) < 30) { step(['attack'], 4); step([P().x < b.x ? 'left' : 'right'], 6); }
    else step([b.x > P().x ? 'right' : 'left'], 3);
    step([], 4);
  }
  // collect the key wherever it flew
  for (const p of game.world.all().filter((e) => e.constructor.name === 'Pickup')) {
    let m = 0; while (Math.abs(P().x - p.x) > 6 && m++ < 300) step([P().x < p.x ? 'right' : 'left'], 2);
    step([], 10);
  }
  n = 0; while (harness.state().roomId === 'gatehouse' && n++ < 700) step(['right'], 3);
  step([], 40);
  const rec = globalThis.window.__harness.recording();
  const good = rec.start.kind === 'scenario' && harness.state().roomId === 'cavern' && P().hp > 0;
  if (good) {
    fs.writeFileSync(OUT, JSON.stringify(rec));
    console.log('seed', seed, 'CLEARED: hp', P().hp, '| fixture', rec.end, 'steps ->', path.basename(OUT));
    await close();
    process.exit(0);
  }
  console.log('seed', seed, 'ended', harness.state().roomId, 'hp', P()?.hp, '- not written');
  await close();
}
console.error('no seed cleared — the balance moved; retune before recording');
process.exit(1);
