import { clamp, type RoomDef, type CollisionSource } from '@engine/index';
import { edgeDoorSide } from './doorways';

export interface DoorLanding {
  x: number;
  y: number;
  carry?: boolean;
}

/** Only geometry is needed: no scene, actor behaviour, or global room registry. */
interface LandingContext {
  sourceId: string;
  source: RoomDef;
  destinationId: string;
  destination: RoomDef;
  player: { x: number; y: number; w: number; h: number; cx: number };
  /** Destination collision including persistent room patches. */
  collision: CollisionSource;
}

/** Pair authored doors and resolve an unoccupied arrival. Null leaves spawn policy to the caller. */
export function resolveDoorLanding(ctx: LandingContext): DoorLanding | null {
  const { sourceId, source, destinationId, destination: dest, player, collision } = ctx;
  const back = dest.triggers?.find(tr => tr.event === 'door' && tr.props?.room === sourceId);
  if (!back) return null;
  const leaving = source.triggers?.find(tr => tr.event === 'door' && tr.props?.room === destinationId);
  const tracked = back.props?.trackX === true && leaving?.props?.trackX === true;
  const edgePair = !!leaving && edgeDoorSide(source, leaving) !== null && edgeDoorSide(dest, back) !== null;
  const { w: pw, h: ph } = player;
  const buried = (x: number, y: number): boolean => {
    for (const s of collision.solidsNear({ x, y, w: pw, h: ph })) {
      if (!s.oneWay && x < s.x + s.w && s.x < x + pw && y < s.y + s.h && s.y < y + ph) return true;
    }
    return false;
  };

  if (back.props?.leapUp === true || back.props?.fallIn === true) {
    const x = tracked && leaving && leaving.w > 0
      ? clamp(back.x + back.w * clamp((player.cx - leaving.x) / leaving.w, 0, 1) - pw / 2,
        back.x, back.x + back.w - pw)
      : back.x + back.w / 2 - pw / 2;
    const y = back.props?.leapUp === true ? back.y : back.y + back.h - ph;
    // Expel downward only: searching upward could cross an intact shaft cap.
    for (let d = 0; d <= 4 * dest.tileSize; d++) {
      if (!buried(x, y + d)) return { x, y: y + d, carry: true };
    }
    return null;
  }

  const roomW = Math.max(...dest.tiles.map(row => row.length)) * dest.tileSize;
  const outward = back.x + back.w / 2 < roomW / 2 ? 1 : -1;
  const half = Math.ceil(pw / 2);
  // Centre one pixel beyond re-entry threshold, with the body still in the doorway.
  const x = outward === 1 ? back.x + back.w - half + 1 : back.x + half - pw - 1;
  const y = clamp(edgePair && leaving && leaving.h > 0
    ? back.y + (player.y - leaving.y) * (back.h / leaving.h)
    : back.y + back.h - ph, 0, dest.tiles.length * dest.tileSize - ph);
  if (!buried(x, y)) return { x, y, carry: edgePair };
  // Unequal sills can bury a mapped arrival. Keep the search local to the opening.
  for (let d = 1; d <= 2 * dest.tileSize; d++) {
    if (!buried(x, y - d)) return { x, y: y - d, carry: edgePair };
    if (!buried(x, y + d)) return { x, y: y + d, carry: edgePair };
  }
  return null;
}
