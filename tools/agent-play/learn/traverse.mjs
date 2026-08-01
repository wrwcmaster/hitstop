/**
 * The other half of playing: getting somewhere.
 *
 * The arena task only ever asks "survive and kill", so a policy trained
 * on it has no reason to go anywhere — and measurably doesn't, it walks
 * into the nearest wall and swings. Reaching the Slime King means
 * crossing three doors first (arena > cavern > corridor > throne), and
 * that is a different skill with a different reward.
 *
 * One episode here is one door: spawn in a room, get told where the exit
 * is, and try to reach it. Short, dense, and unambiguous — the room id
 * changes or it doesn't.
 */
import { loadWorld, doorTo } from './world.mjs';

/** Frames allowed to cross one door. ~20s: generous for a single room. */
export const CROSS_LIMIT = 1200;

/**
 * What a crossing is worth.
 *
 * Reaching the door is nearly everything; the rest is there to break
 * ties between policies that all reach it. Time matters because a policy
 * that dawdles across three rooms never finishes a run, and the arena
 * already taught me that cheap time produces a statue.
 */
export const CROSS_REWARD = { reached: 1000, frame: -0.25, hit: -40, closer: 2 };

/** Every (room, door) pair along a route — the training set for a run. */
export function legsAlong(rooms, path) {
  const legs = [];
  for (let i = 0; i + 1 < path.length; i++) {
    const door = doorTo(rooms, path[i], path[i + 1]);
    if (door) legs.push({ room: path[i], to: path[i + 1], door });
  }
  return legs;
}

/**
 * Play one crossing. `make(goalOf)` builds the act function, so the
 * policy can read the goal that this leg sets.
 */
export function crossing(harness, game, leg, make, { frames = CROSS_LIMIT, give = [] } = {}) {
  const play = () => game.scenes.all().find((s) => s.constructor.name === 'PlayScene');
  const goal = { x: leg.door.x, y: leg.door.y, kind: 1 };
  const act = make(() => goal);

  harness.beginRun({ kind: 'scenario', scenario: {
    room: leg.room, quiet: true,
    player: { give: ['great-sword', ...give], equip: ['great-sword'] },
  } });
  harness.step([], 30);

  const startRoom = harness.state().roomId;
  const p0 = play()?.player;
  // Distance at the start, so partial progress can be scored: a policy
  // that gets halfway should beat one that never moves, or there is
  // nothing for evolution to climb before the first success happens.
  const start = p0 ? Math.hypot(goal.x - p0.cx, goal.y - p0.cy) : 0;
  let best = start;
  let hp = p0?.hp ?? 0;
  let hits = 0;
  let reached = false;
  let f = 0;

  for (; f < frames; f++) {
    const p = play()?.player;
    if (!p || p.hp <= 0) break;
    if (harness.state().roomId !== startRoom) { reached = true; break; }
    if (p.hp < hp) { hits++; hp = p.hp; }
    best = Math.min(best, Math.hypot(goal.x - p.cx, goal.y - p.cy));
    harness.step(act(globalThis.window.__observe()), 1);
  }

  const fitness = (reached ? CROSS_REWARD.reached : 0)
    + CROSS_REWARD.frame * f
    + CROSS_REWARD.hit * hits
    + CROSS_REWARD.closer * Math.max(0, start - best);
  return { fitness, reached, hits, frames: f, closed: Math.round(start - best), start: Math.round(start) };
}

/** The legs from `from` to `to`, ready to train or score against. */
export function legsFor(from, to) {
  const rooms = loadWorld();
  const path = [];
  const seen = new Set([from]);
  const q = [[from]];
  while (q.length) {
    const p = q.shift();
    if (p[p.length - 1] === to) { path.push(...p); break; }
    for (const d of rooms[p[p.length - 1]]?.doors ?? []) {
      if (!seen.has(d.to)) { seen.add(d.to); q.push([...p, d.to]); }
    }
  }
  return { rooms, path, legs: legsAlong(rooms, path) };
}
