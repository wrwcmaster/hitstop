import assert from 'node:assert/strict';
import { loadEngine, close } from './headless.mjs';

try {
  const { server, ROOMS, buildTilemap } = await loadEngine();
  const { resolveDoorLanding } = await server.ssrLoadModule('/src/game/scenes/play/door-landing.ts');
  const { openEdgeDoorways } = await server.ssrLoadModule('/src/game/scenes/play/doorways.ts');
  const player = { x: 8, y: 486, w: 10, h: 18, cx: 13 };
  const context = (sourceId, destinationId, body = player) => {
    const destination = ROOMS[destinationId];
    const collision = buildTilemap(destination);
    openEdgeDoorways(destination, collision);
    return { sourceId, source: ROOMS[sourceId], destinationId, destination, player: body, collision };
  };
  assert.deepEqual(resolveDoorLanding(context('gatehouse', 'kingsroad')), { x: 1730, y: 158, carry: true });
  assert.deepEqual(resolveDoorLanding(context('kingsroad', 'gatehouse',
    { ...player, x: 1732, cx: 1737, y: 158 })), { x: 12, y: 486, carry: true });
  assert.equal(resolveDoorLanding(context('tutorial', 'throne')), null, 'unpaired door delegates arrival policy');
  const blocked = context('gatehouse', 'kingsroad');
  blocked.collision = { solidsNear: () => [{ x: 0, y: 0, w: 2000, h: 1000 }] };
  assert.equal(resolveDoorLanding(blocked), null, 'cannot place inside solid geometry');
  const wide = context('kingsroad', 'gatehouse', { ...player, w: 20, cx: 18, y: 158 });
  assert.equal(resolveDoorLanding(wide)?.x, 7, 'arrival uses actual body width, not a knight-size fallback');
  const { advanceTransition, transitionOpacity } = await server.ssrLoadModule('/src/game/scenes/play/door-transition.ts');
  const tr = { t: 0, roomId: 'test', x: 0, y: 0, walked: 0, walk: { out: -1, into: 1 } };
  const events = [];
  const effects = {
    walk: (direction, dt) => { if (dt > 0) events.push(direction < 0 ? 'out' : 'in'); return dt * 72; },
    swap: () => { assert.equal(transitionOpacity(tr), 1); events.push('swap'); },
    stop: () => events.push('stop'),
  };
  let complete = false;
  for (let i = 0; i < 60 && !complete; i++) complete = advanceTransition(tr, 1 / 60, effects);
  assert.ok(complete);
  assert.equal(events.filter(e => e === 'swap').length, 1, 'one room swap per transition');
  assert.ok(events.indexOf('out') < events.indexOf('swap'));
  assert.ok(events.indexOf('swap') < events.indexOf('in'));
  assert.equal(events.at(-1), 'stop');
  assert.ok(tr.walked >= 8 && tr.walked <= 9.2, 'walk-in cap allows one fixed-step remainder');
  assert.equal(transitionOpacity(tr), 0);
  const opening = { t: 0, roomId: 'test', x: 0, y: 0, walked: 0, open: { left: .35, x: 0, y: 0, w: 8, h: 32 } };
  assert.equal(advanceTransition(opening, .1, effects), false);
  assert.equal(opening.t, 0, 'gate opens before fade clock starts');
  console.log('door landing: 5 checks passed');
  console.log('door transition: phase order, opacity, cap, and opening delay passed');
} finally {
  await close();
}
