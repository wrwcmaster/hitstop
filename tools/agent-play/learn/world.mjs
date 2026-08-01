/**
 * The world as a graph, and the shortest way through it.
 *
 * Navigation is not something to learn. Twenty-two rooms joined by 42
 * doors is a solved problem the moment you read the doors out of the
 * room JSON, and a search over it is exact, instant and needs no
 * training. A policy asked to discover it by perturbing 2,106 weights
 * would be doing the one thing search is better at, and doing it badly:
 * the reward for "reach a room five doors away" arrives never, so there
 * is nothing for evolution to climb.
 *
 * The split this enables is the point — search decides WHERE, the
 * learned policy handles HOW.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const roomsDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..',
  'src', 'game', 'content', 'rooms',
);

/** Door ids in room JSON use hyphens; file names use underscores. */
const norm = (id) => id.replace(/-/g, '_');

/**
 * Read every room and its doors.
 *
 * A door is a trigger with `event: 'door'` and a target room in props —
 * the same records the game itself acts on, so this cannot drift from
 * what a knight can actually walk through.
 */
export function loadWorld() {
  const rooms = {};
  for (const file of fs.readdirSync(roomsDir).filter((f) => f.endsWith('.json'))) {
    const def = JSON.parse(fs.readFileSync(path.join(roomsDir, file), 'utf8'));
    const id = file.replace('.json', '');
    const doors = (def.triggers ?? [])
      .filter((t) => t.event === 'door' && t.props?.room)
      .map((t) => ({
        to: norm(t.props.room),
        // Where the trigger sits, so a policy can be told which way to go.
        x: t.x + (t.w ?? 8) / 2,
        y: t.y + (t.h ?? 8) / 2,
        w: t.w ?? 8,
        h: t.h ?? 8,
      }));
    rooms[id] = { id, doors, waves: def.props?.waves ?? null, name: def.name ?? id };
  }
  return rooms;
}

/**
 * Fewest doors from `from` to `to`. Returns the room sequence, or null.
 *
 * Breadth-first is right for now because every edge costs the same. It
 * will stop being right the moment we measure that some crossings fail —
 * a door the policy muffs two times in three is not one door away, and
 * routing through it forever is how a planner strands a runner. When
 * rollouts can report per-edge success, swap this for Dijkstra weighted
 * by -log(success). The shape of the call does not change.
 */
export function route(rooms, from, to) {
  const start = norm(from);
  const goal = norm(to);
  if (!rooms[start] || !rooms[goal]) return null;
  const seen = new Set([start]);
  const queue = [[start]];
  while (queue.length) {
    const path_ = queue.shift();
    const at = path_[path_.length - 1];
    if (at === goal) return path_;
    for (const d of rooms[at]?.doors ?? []) {
      if (seen.has(d.to)) continue;
      seen.add(d.to);
      queue.push([...path_, d.to]);
    }
  }
  return null;
}

/** The door in `room` that leads to `next`, if there is one. */
export function doorTo(rooms, room, next) {
  return (rooms[norm(room)]?.doors ?? []).find((d) => d.to === norm(next)) ?? null;
}

// Run directly to see the map: node tools/agent-play/learn/world.mjs [from] [to]
if (process.argv[1] && process.argv[1].endsWith('world.mjs')) {
  const rooms = loadWorld();
  const from = process.argv[2] ?? 'arena';
  const to = process.argv[3] ?? 'throne';
  const r = route(rooms, from, to);
  console.log(`${Object.keys(rooms).length} rooms, `
    + `${Object.values(rooms).reduce((n, x) => n + x.doors.length, 0)} doors`);
  console.log(`${from} -> ${to}:`, r ? r.join(' > ') : 'NO ROUTE');
  if (r) {
    for (let i = 0; i + 1 < r.length; i++) {
      const d = doorTo(rooms, r[i], r[i + 1]);
      console.log(`   in ${r[i].padEnd(16)} head for the door at (${d.x}, ${d.y}) -> ${r[i + 1]}`);
    }
  }
}
