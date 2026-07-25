import { tiles, type Tilemap } from './tilemap';
import type { RoomEntity } from './room';

/**
 * Room patches: the difference between a room as authored and the room
 * as the world has left it.
 *
 * A `RoomDef` is immutable content — it is loaded from JSON, shared by
 * every visit, and rebuilt from scratch each time you walk back in. That
 * is what makes rooms cheap and the editor safe, and it is also why a
 * floor you smash grows back the moment you leave. A patch is the small,
 * serializable record of what changed, replayed over the freshly built
 * room so the change sticks.
 *
 * The engine knows only two kinds of change, both deliberately generic:
 * a tile became a different tile, and a placed entity should not come
 * back. What counts as breakable, what a broken floor means, and which
 * changes are worth keeping are all decisions for the game — this module
 * just remembers and reapplies.
 *
 * Everything here is plain JSON, so a patch set drops straight into a
 * save blob, a replay tape, or a network snapshot with no conversion.
 */
export interface RoomPatch {
  /** Tile replacements, keyed `"tx,ty"`. `''` is the empty tile. */
  tiles?: Record<string, string>;
  /** Keys (see `entityKey`) of placed entities that must not respawn. */
  removed?: string[];
}

/** Every patched room, keyed by room id. */
export type RoomPatchSet = Record<string, RoomPatch>;

/**
 * Stable identity for an entity a room places: what it is and where it
 * was authored. Deliberately not the array index — rooms get edited, and
 * an index silently retargets when one entity is inserted above another,
 * which would resurrect a looted chest and delete an untouched one. A key
 * that no longer matches anything simply matches nothing.
 */
export function entityKey(e: RoomEntity): string {
  return `${e.type}@${Math.round(e.x)},${Math.round(e.y)}`;
}

function parseCoord(key: string): [number, number] | null {
  const comma = key.indexOf(',');
  if (comma <= 0) return null;
  const tx = Number(key.slice(0, comma));
  const ty = Number(key.slice(comma + 1));
  if (!Number.isInteger(tx) || !Number.isInteger(ty)) return null;
  return [tx, ty];
}

/**
 * The recorded mutations for a whole run, and the two operations that
 * matter: record one change, and reapply everything a room has.
 *
 * Application is idempotent by construction — a patch says what a tile
 * *is*, not what happened to it, so replaying the same set over a fresh
 * room any number of times lands on the same geometry.
 */
export class RoomPatches {
  private rooms = new Map<string, RoomPatch>();
  /**
   * Bumped on every mutation (and on clear/restore). A consumer that
   * mirrors this set — the co-op host resending geometry to its guest —
   * compares revisions instead of deep-comparing or re-serializing the
   * whole set every frame. `count()` cannot serve here: overwriting one
   * tile id with another leaves the count unchanged.
   */
  private rev = 0;

  /** Monotonic change marker; equal revisions mean identical contents. */
  get revision(): number {
    return this.rev;
  }

  private edit(roomId: string): RoomPatch {
    let patch = this.rooms.get(roomId);
    if (!patch) {
      patch = {};
      this.rooms.set(roomId, patch);
    }
    return patch;
  }

  /** Remember that `(tx, ty)` in `roomId` is now `id` (`''` = removed). */
  setTile(roomId: string, tx: number, ty: number, id: string): void {
    if (!Number.isInteger(tx) || !Number.isInteger(ty)) return;
    const patch = this.edit(roomId);
    (patch.tiles ??= {})[`${tx},${ty}`] = id;
    this.rev++;
  }

  /** Remember that the entity with this key is gone for good. */
  removeEntity(roomId: string, key: string): void {
    const patch = this.edit(roomId);
    const removed = (patch.removed ??= []);
    if (!removed.includes(key)) removed.push(key);
    this.rev++;
  }

  /** Should this room skip spawning the entity with this key? */
  isRemoved(roomId: string, key: string): boolean {
    return this.rooms.get(roomId)?.removed?.includes(key) === true;
  }

  /**
   * Stamp `roomId`'s recorded tiles onto a freshly built map. Returns how
   * many landed — coordinates outside the map and tile ids that no longer
   * exist are skipped, so a patch set outlives the room edit or content
   * rename that invalidated part of it instead of throwing on load.
   */
  applyTiles(roomId: string, map: Tilemap): number {
    const patch = this.rooms.get(roomId);
    if (!patch?.tiles) return 0;
    let applied = 0;
    for (const [key, id] of Object.entries(patch.tiles)) {
      const at = parseCoord(key);
      if (!at || !tiles.has(id)) continue;
      const [tx, ty] = at;
      if (tx < 0 || ty < 0 || tx >= map.cols || ty >= map.rows) continue;
      map.setTile(tx, ty, id);
      applied++;
    }
    return applied;
  }

  /** Total recorded changes — a cheap fingerprint for replay state. */
  count(): number {
    let n = 0;
    for (const patch of this.rooms.values()) {
      n += Object.keys(patch.tiles ?? {}).length + (patch.removed?.length ?? 0);
    }
    return n;
  }

  clear(): void {
    this.rooms.clear();
    this.rev++;
  }

  /** A deep, JSON-safe copy — for saves, replay tapes, and net sync. */
  snapshot(): RoomPatchSet {
    const out: RoomPatchSet = {};
    for (const [roomId, patch] of this.rooms) {
      const copy: RoomPatch = {};
      if (patch.tiles && Object.keys(patch.tiles).length) copy.tiles = { ...patch.tiles };
      if (patch.removed?.length) copy.removed = [...patch.removed];
      if (copy.tiles || copy.removed) out[roomId] = copy;
    }
    return out;
  }

  /**
   * Replace everything with `data`. Absent or malformed input leaves an
   * empty set rather than throwing: a save from before patches existed
   * is not an error, it is a run that has broken nothing yet.
   */
  restore(data: RoomPatchSet | undefined | null): void {
    this.rooms.clear();
    this.rev++;
    if (!data || typeof data !== 'object') return;
    for (const [roomId, patch] of Object.entries(data)) {
      if (!patch || typeof patch !== 'object') continue;
      const tileEntries = Object.entries(patch.tiles ?? {}).filter(
        ([key, id]) => parseCoord(key) !== null && typeof id === 'string',
      );
      const removed = (patch.removed ?? []).filter((key) => typeof key === 'string');
      if (!tileEntries.length && !removed.length) continue;
      const copy: RoomPatch = {};
      if (tileEntries.length) copy.tiles = Object.fromEntries(tileEntries);
      if (removed.length) copy.removed = [...removed];
      this.rooms.set(roomId, copy);
    }
  }
}
