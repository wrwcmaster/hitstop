import { Registry, items, songs, tiles, type RoomDef, type TriggerDef } from '@engine/index';
import { placeables } from './placeables';
import { waveTables } from './waves';
import { propsAt, requirePositiveNumber } from './prop-validation';
import { triggerActions } from '../scenes/play/trigger-actions';

export interface RoomFeature {
  validate(value: unknown, room: RoomDef, path: string): void;
}

export const roomFeatures = new Registry<RoomFeature>('roomFeature');

export function defineRoomFeature(key: string, feature: RoomFeature): void {
  roomFeatures.register(key, feature);
}

defineRoomFeature('music', {
  validate(value, _room, path) {
    if (typeof value !== 'string' || !songs.has(value)) throw new Error(`${path}: unknown song "${String(value)}"`);
  },
});

defineRoomFeature('waves', {
  validate(value, _room, path) {
    if (typeof value !== 'string' || !waveTables.has(value)) throw new Error(`${path}: unknown wave table "${String(value)}"`);
  },
});

defineRoomFeature('waveGoal', {
  validate(value, _room, path) {
    requirePositiveNumber(value, path, true);
  },
});

defineRoomFeature('gateKey', {
  validate(value, _room, path) {
    if (typeof value !== 'string' || !items.has(value)) throw new Error(`${path}: unknown item "${String(value)}"`);
  },
});

/**
 * Where this room's top-left corner sits on the world map, in grid
 * cells. A room that declares it appears on the map screen; one that
 * doesn't, doesn't — which is how the dev test room stays off a
 * player-facing screen with no special case anywhere.
 *
 * Only the position is authored. How many cells the room COVERS is
 * derived from its actual tile dimensions (see content/worldmap.ts), so
 * a hall that is four screens wide draws four cells wide without anyone
 * maintaining a second number that could drift from the truth.
 */
defineRoomFeature('map', {
  validate(value, _room, path) {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw new Error(`${path}: expected an object like { x, y }`);
    }
    const cell = value as Record<string, unknown>;
    for (const key of Object.keys(cell)) {
      if (key !== 'x' && key !== 'y') {
        throw new Error(`${path}.${key}: unexpected — a room's map span comes from its tile size, only { x, y } is authored`);
      }
    }
    for (const key of ['x', 'y']) {
      if (!Number.isInteger(cell[key])) throw new Error(`${path}.${key}: expected an integer cell coordinate`);
    }
  },
});

/**
 * A doorway walled up in solid rock is a room you cannot leave, and it
 * looks completely fine in the JSON — the trigger is present, points
 * somewhere real, and validates. Only the tiles underneath say
 * otherwise.
 *
 * This is not hypothetical: moving doorways flush against the room
 * boundary buried three of them (grotto, ramparts and vault all have a
 * wall in column 0), sealing off three rooms at once. Nothing caught it
 * until a boss-seal test had the knight standing still against a door
 * that was never there.
 */
function requireReachable(room: RoomDef, door: TriggerDef, path: string): void {
  const ts = room.tileSize;
  const c0 = Math.floor(door.x / ts);
  const c1 = Math.floor((door.x + door.w - 1) / ts);
  const r0 = Math.floor(door.y / ts);
  const r1 = Math.floor((door.y + door.h - 1) / ts);
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      const ch = (room.tiles[r] ?? '')[c] ?? '';
      const id = room.legend[ch] ?? '';
      if (!id || !tiles.get(id).solid) return; // somewhere to stand
    }
  }
  throw new Error(
    `${path}: doorway to "${String(door.props?.room)}" is walled in — `
    + `every tile in cols ${c0}-${c1}, rows ${r0}-${r1} is solid, so the door cannot be reached`,
  );
}

/** Validate open content bags after all game registries have been filled. */
export function validateRoomContent(room: RoomDef, id = room.name): RoomDef {
  const root = `room "${id}"`;
  const roomProps = propsAt(room.props, `${root}.props`);
  for (const [key, value] of Object.entries(roomProps)) {
    if (!roomFeatures.has(key)) throw new Error(`${root}.props.${key}: unknown room feature`);
    roomFeatures.get(key).validate(value, room, `${root}.props.${key}`);
  }

  room.entities.forEach((entity, index) => {
    const path = `${root}.entities[${index}] (${entity.type}).props`;
    const props = propsAt(entity.props, path);
    if (placeables.has(entity.type)) placeables.get(entity.type).validateProps?.(props, path);
  });

  (room.triggers ?? []).forEach((trigger, index) => {
    const path = `${root}.triggers[${index}] (${trigger.event}).props`;
    const props = propsAt(trigger.props, path);
    if (triggerActions.has(trigger.event)) triggerActions.get(trigger.event).validateProps?.(props, path);
    if (trigger.event === 'door') requireReachable(room, trigger, `${root}.triggers[${index}]`);
  });
  return room;
}
