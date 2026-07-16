import { Tilemap } from './tilemap';
import { TriggerDef } from './triggers';

/**
 * Room file format — the unit of level design, and what the level editor
 * reads and writes. Plain JSON so it's diffable and tool-friendly.
 *
 * Tiles are rows of single characters; the legend maps characters to
 * registered tile ids. Entities are spawned by the game via its actor
 * registry when the room loads.
 */
export interface RoomDef {
  name: string;
  tileSize: number;
  /** char -> tile id. Characters not in the legend are empty. */
  legend: Record<string, string>;
  /** One string per row; all rows the same length. */
  tiles: string[];
  playerSpawn: { x: number; y: number };
  entities: RoomEntity[];
  /** Regions that fire named events on entry (see level/triggers.ts). */
  triggers?: TriggerDef[];
  /** Optional per-room properties (music, ambience, wave table id...). */
  props?: Record<string, unknown>;
}

export interface RoomEntity {
  type: string;
  x: number;
  y: number;
  /** Free-form per-instance overrides, passed to the actor def's init. */
  props?: Record<string, unknown>;
}

/** Build a Tilemap from a RoomDef. */
export function buildTilemap(def: RoomDef): Tilemap {
  const width = Math.max(...def.tiles.map((r) => r.length));
  const grid = def.tiles.map((row) => {
    const cells: string[] = [];
    for (let x = 0; x < width; x++) {
      cells.push(def.legend[row[x] ?? ''] ?? '');
    }
    return cells;
  });
  return new Tilemap(grid, def.tileSize);
}

/** Validate a room def loaded from untrusted JSON (editor import, saves). */
export function validateRoom(def: unknown): RoomDef {
  const d = def as Partial<RoomDef>;
  if (!d || typeof d !== 'object') throw new Error('room: not an object');
  if (typeof d.name !== 'string') throw new Error('room: missing name');
  if (typeof d.tileSize !== 'number' || d.tileSize <= 0) throw new Error('room: bad tileSize');
  if (!Array.isArray(d.tiles) || d.tiles.length === 0 || d.tiles.some((row) => typeof row !== 'string')) {
    throw new Error('room: tiles must be a non-empty string array');
  }
  if (!d.legend || typeof d.legend !== 'object') throw new Error('room: missing legend');
  if (!d.playerSpawn || !Number.isFinite(d.playerSpawn.x) || !Number.isFinite(d.playerSpawn.y)) {
    throw new Error('room: bad playerSpawn');
  }
  if (!Array.isArray(d.entities)) throw new Error('room: missing entities');
  d.entities.forEach((entity, index) => {
    if (!entity || typeof entity !== 'object') throw new Error(`room: entities[${index}] is not an object`);
    if (typeof entity.type !== 'string' || !Number.isFinite(entity.x) || !Number.isFinite(entity.y)) {
      throw new Error(`room: entities[${index}] has a bad type or position`);
    }
  });
  if (d.triggers !== undefined && !Array.isArray(d.triggers)) throw new Error('room: triggers must be an array');
  d.triggers?.forEach((trigger, index) => {
    if (!trigger || typeof trigger !== 'object') throw new Error(`room: triggers[${index}] is not an object`);
    if (typeof trigger.event !== 'string' ||
        !Number.isFinite(trigger.x) || !Number.isFinite(trigger.y) ||
        !Number.isFinite(trigger.w) || !Number.isFinite(trigger.h)) {
      throw new Error(`room: triggers[${index}] has a bad event or bounds`);
    }
  });
  return d as RoomDef;
}
