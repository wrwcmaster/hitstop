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

/**
 * Doors that need a traversal verb, which the room JSON does not say.
 *
 * These gates are PHYSICAL, not declared: underground to riven-lip is a
 * cracked cap you break with impact-drop, so there is no property to
 * read and no way to infer it. The list is therefore hand-maintained,
 * and it is the same knowledge `sweep.mjs` keeps in its VERB_GATED table
 * for the same reason — when a new gate is authored, both want updating.
 *
 * Without this the verb-aware routing is INERT: `loadWorld()` sets no
 * `needs`, so every gate check passes and a planner cheerfully routes a
 * verbless knight through a wall she cannot break. Passing `verbs: null`
 * (the default) still ignores gating, which is what the CLI map view
 * wants; a real planner must pass the set she actually owns.
 */
export const VERB_GATES = {
  'underground>riven_lip': 'impact-drop',
};

/** Door ids in room JSON use hyphens; file names use underscores. */
const norm = (id) => id.replace(/-/g, '_');

/**
 * Read every room and its doors.
 *
 * A door is a trigger with `event: 'door'` and a target room in props —
 * the same records the game itself acts on, so this cannot drift from
 * what a knight can actually walk through.
 */
export function loadWorld({ gates = VERB_GATES } = {}) {
  const rooms = {};
  for (const file of fs.readdirSync(roomsDir).filter((f) => f.endsWith('.json'))) {
    const def = JSON.parse(fs.readFileSync(path.join(roomsDir, file), 'utf8'));
    const id = file.replace('.json', '');
    const doors = (def.triggers ?? [])
      .filter((t) => t.event === 'door' && t.props?.room)
      .map((t) => ({
        to: norm(t.props.room),
        needs: gates[`${id}>${norm(t.props.room)}`] ?? null,
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
 * The cheapest way from `from` to `to`, given what she can do and what
 * we have learned about the doors. Returns the room sequence, or null.
 *
 * Not plain breadth-first, because "fewest doors" is the wrong cost the
 * moment a crossing can fail. Two things make an edge expensive:
 *
 *   IT NEEDS A VERB SHE DOES NOT HAVE. The world is a Metroidvania —
 *   four bosses, each granting a traversal verb, each opening more map.
 *   Routing through a door that wants impact-drop before the Slime King
 *   is dead is not a long route, it is no route.
 *
 *   SHE KEEPS FAILING IT. A door muffed two times in three is not one
 *   door away, and a planner that keeps sending her at it will strand
 *   her forever. An edge costs its EXPECTED ATTEMPTS, 1/p — a door that
 *   works one time in twenty costs eleven, which correctly loses to an
 *   eight-room detour. (I first wrote -log(p), which charges that same
 *   door 3.4 and kept routing through it; log-cost is the right shape
 *   when failure is fatal, and here it is merely a retry.) Nothing is
 *   ever hard-banned, so evidence can change its mind.
 *
 * Gating is NOT readable from the room JSON, which is why it arrives as
 * an argument. The one declared gate in the repo (underground to
 * riven-lip) is physical: a cracked cap you break with impact-drop. So
 * feasibility has to be measured or told, never inferred.
 */
export function route(rooms, from, to, { verbs = null, edgeStats = null } = {}) {
  const start = norm(from);
  const goal = norm(to);
  if (!rooms[start] || !rooms[goal]) return null;

  const cost = (a, d) => {
    if (d.needs && verbs && !verbs.has(d.needs)) return Infinity;
    const s = edgeStats?.[`${a}>${d.to}`];
    if (!s || !s.tries) return 1;
    // Laplace: one success and one failure of imaginary evidence, so a
    // single unlucky attempt does not condemn a door outright.
    const p = (s.wins + 1) / (s.tries + 2);
    return 1 / p;
  };

  // Dijkstra. The graph is 22 nodes; a heap would be ceremony.
  const dist = { [start]: 0 };
  const prev = {};
  const done = new Set();
  for (;;) {
    let at = null;
    for (const k of Object.keys(dist)) if (!done.has(k) && (at === null || dist[k] < dist[at])) at = k;
    if (at === null || dist[at] === Infinity) return null;
    if (at === goal) break;
    done.add(at);
    for (const d of rooms[at]?.doors ?? []) {
      const c = cost(at, d);
      if (c === Infinity) continue;
      const alt = dist[at] + c;
      if (dist[d.to] === undefined || alt < dist[d.to]) { dist[d.to] = alt; prev[d.to] = at; }
    }
  }
  const path = [goal];
  while (path[0] !== start) path.unshift(prev[path[0]]);
  return path;
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
