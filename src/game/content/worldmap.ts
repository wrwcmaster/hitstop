import type { WorldMapCell, WorldMapDoor } from '@engine/index';
import { ROOMS } from './rooms';

/**
 * Where each room sits on the world map, and how they join up.
 *
 * Placement is pure data: a room opts in with `props.map = { x, y }` and
 * appears on the map; leave it out and it doesn't — which is how the dev
 * test room stays off a player-facing screen without any special case.
 *
 * Only that POSITION is authored. A room's size on the map is derived
 * from its tile dimensions, in screens, so a four-screen hall draws four
 * cells wide and the map reads as a real floor plan rather than a
 * uniform flowchart.
 *
 * The CONNECTIONS are not authored at all. Rooms already say how they
 * join through their `door` triggers, so the door marks are derived from
 * those. One source of truth: move a door and the map follows, with no
 * second table to forget to update.
 */

/**
 * One map cell is one screenful of room: the 240x135 view is 30x17 tiles
 * at the standard 8px tile. So a room's size on the map is the number of
 * screens it occupies, which is what makes a big hall read as big.
 */
export const CELL_TILES = { w: 30, h: 17 };

interface MapPlacement {
  x: number;
  y: number;
}

function placementOf(id: string): MapPlacement | null {
  const m = ROOMS[id]?.props?.map as MapPlacement | undefined;
  if (!m || !Number.isInteger(m.x) || !Number.isInteger(m.y)) return null;
  return m;
}

/** A room's span in cells, from its actual tile dimensions. */
function spanOf(id: string): { w: number; h: number } {
  const rows = ROOMS[id].tiles;
  const cols = Math.max(...rows.map((r) => r.length));
  return {
    w: Math.max(1, Math.ceil(cols / CELL_TILES.w)),
    h: Math.max(1, Math.ceil(rows.length / CELL_TILES.h)),
  };
}

export const WORLD_MAP_CELLS: WorldMapCell[] = Object.keys(ROOMS).flatMap((id) => {
  const m = placementOf(id);
  return m ? [{ id, x: m.x, y: m.y, ...spanOf(id) }] : [];
});

/**
 * Overlapping rooms would silently draw on top of each other, and since
 * spans are DERIVED from room size, simply making a room bigger can push
 * it into its neighbour. Fail loudly at boot instead — the same bargain
 * the rest of the content validation makes.
 */
(() => {
  for (let i = 0; i < WORLD_MAP_CELLS.length; i++) {
    for (let j = i + 1; j < WORLD_MAP_CELLS.length; j++) {
      const a = WORLD_MAP_CELLS[i];
      const b = WORLD_MAP_CELLS[j];
      const aw = a.w ?? 1, ah = a.h ?? 1, bw = b.w ?? 1, bh = b.h ?? 1;
      if (a.x < b.x + bw && b.x < a.x + aw && a.y < b.y + bh && b.y < a.y + ah) {
        throw new Error(
          `world map: rooms "${a.id}" (${a.x},${a.y} ${aw}x${ah}) and `
          + `"${b.id}" (${b.x},${b.y} ${bw}x${bh}) overlap — `
          + 'move one in its props.map, or shrink the room',
        );
      }
    }
  }
})();

/**
 * Each connecting door, placed at its true spot on the map: the door's
 * position within its room, scaled into that room's cell span and offset
 * to the room's map origin. So the mark lands on the shared edge where the
 * doorway actually is, not at a midpoint between region centres.
 *
 * A door is emitted once per room pair (the first side seen wins), so the
 * two ends of one passage draw a single mark on the boundary they share.
 */
/** Do two placed rooms share an edge on the grid? */
function adjacent(a: string, b: string): boolean {
  const ma = placementOf(a);
  const mb = placementOf(b);
  if (!ma || !mb) return false;
  const sa = spanOf(a);
  const sb = spanOf(b);
  const xOverlap = ma.x < mb.x + sb.w && mb.x < ma.x + sa.w;
  const yOverlap = ma.y < mb.y + sb.h && mb.y < ma.y + sa.h;
  const xTouch = ma.x + sa.w === mb.x || mb.x + sb.w === ma.x;
  const yTouch = ma.y + sa.h === mb.y || mb.y + sb.h === ma.y;
  return (xOverlap && yTouch) || (yOverlap && xTouch);
}

const CONNECTIONS = (() => {
  const seen = new Set<string>();
  const doors: WorldMapDoor[] = [];
  const links: [string, string][] = [];
  for (const [id, def] of Object.entries(ROOMS)) {
    const m = placementOf(id);
    if (!m) continue;
    const cols = Math.max(...def.tiles.map((r) => r.length));
    const roomW = cols * def.tileSize;
    const roomH = def.tiles.length * def.tileSize;
    const span = spanOf(id);
    for (const tr of def.triggers ?? []) {
      if (tr.event !== 'door') continue;
      const to = tr.props?.room;
      if (typeof to !== 'string' || to === id || !placementOf(to)) continue;
      const key = [id, to].sort().join(' ');
      if (seen.has(key)) continue;
      seen.add(key);
      // A pip belongs ON a shared edge. When two rooms do not touch, there
      // is no shared edge to put one on, and drawing it anyway plants a
      // mark in empty space that means nothing — which is most of why the
      // map read as wrong. Those get a line instead, which is the honest
      // shape for what they are: the riven flue is a long shaft climbing
      // from the depths back up to town, and no grid can seat it beside
      // both ends at once. A line also makes a MISPLACED room obvious,
      // since a passage that ought to be a pip shows up as a wire.
      if (adjacent(id, to)) {
        doors.push({
          a: id,
          b: to,
          x: m.x + ((tr.x + tr.w / 2) / roomW) * span.w,
          y: m.y + ((tr.y + tr.h / 2) / roomH) * span.h,
        });
      } else {
        links.push([id, to]);
      }
    }
  }
  return { doors, links };
})();

export const WORLD_MAP_DOORS: WorldMapDoor[] = CONNECTIONS.doors;
/** Connections whose rooms do not touch: drawn as a line, not a pip. */
export const WORLD_MAP_LINKS: readonly (readonly [string, string])[] = CONNECTIONS.links;

/** Display name for a room, falling back to its id. */
export function roomLabel(id: string): string {
  return ROOMS[id]?.name ?? id;
}
