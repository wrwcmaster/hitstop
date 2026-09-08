import assert from 'node:assert/strict';
import { bootGame, close } from './headless.mjs';

try {
  const { game, harness, server } = await bootGame({ seed: 44 });
  harness.beginRun({ kind: 'scenario', scenario: { room: 'gatehouse', quiet: true } });
  harness.step([], 2);
  const state = JSON.stringify(harness.state());
  for (const scenario of [
    { room: 'misspelled-room' },
    { player: { give: ['misspelled-item'] } },
    { player: { equip: ['misspelled-item'] } },
    { player: { earned: ['misspelled-verb'] } },
    { spawn: [{ type: 'misspelled-monster', x: 10 }] },
  ]) {
    assert.throws(() => harness.beginRun({ kind: 'scenario', scenario }));
    assert.equal(JSON.stringify(harness.state()), state, 'invalid scenario leaves the current world intact');
  }
  const scene = game.scenes.all().find(s => s.constructor.name === 'PlayScene');
  assert.throws(() => scene.roomById('misspelled-room'), /Unknown room/);
  assert.equal(scene.portalLanding('gatehouse', 10), null, 'padless rooms use authored arrivals');
  const { portalDests, definePortal } = await server.ssrLoadModule('/src/game/content/portals.ts');
  const { ROOMS } = await server.ssrLoadModule('/src/game/content/rooms/index.ts');
  for (const dest of portalDests()) {
    const pad = ROOMS[dest.room].triggers.find(t => t.event === 'portal');
    assert.ok(pad, dest.room);
    assert.deepEqual(scene.portalLanding(dest.room, 10), { x: pad.x + pad.w / 2 - 5, y: pad.y });
    assert.ok(Number.isFinite(dest.x) && Number.isFinite(dest.y), 'authored arrivals remain in the catalog');
  }
  const authored = { room: 'gatehouse', label: 'Padless test destination', order: 100, x: 120, y: 460 };
  definePortal('padless-test', authored);
  harness.beginRun({ kind: 'scenario', scenario: { room: 'town', quiet: true } });
  scene.flags.add('visited:gatehouse');
  scene.openPortal();
  const menu = game.scenes.all().at(-1);
  const index = menu.dests.findIndex(d => d.room === authored.room);
  assert.ok(index >= 0, 'registered padless destination appears in the menu');
  menu.menu.entries[index].onSelect();
  assert.equal(scene.transition.roomId, authored.room);
  assert.equal(scene.transition.x, authored.x);
  assert.equal(scene.transition.y, authored.y);
  const { actionLabel } = await server.ssrLoadModule('/src/game/defs.ts');
  const matchMedia = window.matchMedia;
  const input = { codesFor: () => ['KeyE'] };
  window.matchMedia = () => ({ matches: true });
  assert.equal(actionLabel({ input }, 'interact', ''), 'E');
  window.matchMedia = () => ({ matches: false });
  assert.equal(actionLabel({ input }, 'interact', ''), '');
  assert.equal(actionLabel({ input, pad: { connected: true, buttonsFor: () => [3] } }, 'interact', ''), 'Y');
  window.matchMedia = matchMedia;
  console.log('refactor contracts: invalid references, portal arrivals, and device labels passed');
} finally {
  await close();
}
