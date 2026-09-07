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
  assert.throws(() => scene.portalLanding('gatehouse', 10), /no portal pad/);
  const { portalDests } = await server.ssrLoadModule('/src/game/content/portals.ts');
  const { ROOMS } = await server.ssrLoadModule('/src/game/content/rooms/index.ts');
  for (const dest of portalDests()) {
    const pad = ROOMS[dest.room].triggers.find(t => t.event === 'portal');
    assert.ok(pad, dest.room);
    assert.deepEqual(scene.portalLanding(dest.room, 10), { x: pad.x + pad.w / 2 - 5, y: pad.y });
    assert.ok(!('x' in dest) && !('y' in dest), 'one source of portal arrival geometry');
  }
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
