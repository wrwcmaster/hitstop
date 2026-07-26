import { tiles, type RoomDef, type Tilemap, type TriggerDef } from '@engine/index';

/**
 * Which outer edge a horizontal doorway belongs to.
 *
 * Room authors place triggers in the usable air beside a wall, so a door
 * can sit a tile or two inside the literal map boundary. One shared rule
 * identifies those thresholds for contact firing, opening the wall, and
 * walk-through transitions; no room ids or coordinate exceptions.
 */
export function edgeDoorSide(room: RoomDef, door: TriggerDef): -1 | 1 | null {
  if (door.event !== 'door') return null;
  if (door.props?.fallIn === true || door.props?.leapUp === true) return null;
  const width = Math.max(...room.tiles.map((row) => row.length)) * room.tileSize;
  const leftGap = door.x;
  const rightGap = width - (door.x + door.w);
  const margin = room.tileSize * 3;
  const nearLeft = leftGap >= 0 && leftGap <= margin;
  const nearRight = rightGap >= 0 && rightGap <= margin;
  if (!nearLeft && !nearRight) return null;
  return nearLeft && (!nearRight || leftGap <= rightGap) ? -1 : 1;
}

/**
 * An edge-door trigger is the source of truth for a passable threshold.
 * Clear ordinary collision tiles between that trigger and the map edge,
 * while preserving authored gate tiles so real doors can still open.
 *
 * This derived geometry is deliberately not a room patch: every load
 * recreates it from content, and all edge connections inherit it.
 */
export function openEdgeDoorways(room: RoomDef, map: Tilemap): void {
  const ts = room.tileSize;
  for (const door of room.triggers ?? []) {
    const side = edgeDoorSide(room, door);
    if (side === null) continue;
    const firstRow = Math.max(0, Math.floor(door.y / ts));
    const lastRow = Math.min(map.rows - 1, Math.floor((door.y + door.h - 0.001) / ts));
    const triggerFirstCol = Math.max(0, Math.floor(door.x / ts));
    const triggerLastCol = Math.min(map.cols - 1, Math.floor((door.x + door.w - 0.001) / ts));
    const firstCol = side === -1 ? 0 : triggerFirstCol;
    const lastCol = side === -1 ? triggerLastCol : map.cols - 1;
    for (let ty = firstRow; ty <= lastRow; ty++) {
      for (let tx = firstCol; tx <= lastCol; tx++) {
        const id = map.tileAt(tx, ty);
        if (id === 'gate') continue;
        const def = tiles.get(id);
        if (def.solid || def.oneWay) map.setTile(tx, ty, '');
      }
    }
  }
}
