import { Registry, items, songs, tiles, type RoomDef, type TriggerDef } from '@engine/index';
import { placeables } from './placeables';
import { waveTables } from './waves';
import { propsAt, requirePositiveNumber } from './prop-validation';
import { backdrops } from './backdrops';

export interface RoomFeature {
  validate(value: unknown, room: RoomDef, path: string): void;
}

/**
 * The `validateProps` half of the trigger-action registry — the only
 * part room validation needs. Declared here structurally rather than
 * imported, because trigger actions live in the scene layer (their
 * `run` drives the scene through PlayHost) and content must not depend
 * on scenes. The scene layer hands its registry over at import time via
 * `provideTriggerValidators`; `Registry<TriggerAction>` satisfies this
 * shape as-is.
 */
export interface TriggerValidatorSource {
  has(event: string): boolean;
  get(event: string): { validateProps?(props: Record<string, unknown>, path: string): void };
}

let triggerValidators: TriggerValidatorSource | null = null;

/** Called once by scenes/play/trigger-actions.ts when it loads. */
export function provideTriggerValidators(source: TriggerValidatorSource): void {
  triggerValidators = source;
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

defineRoomFeature('backdrop', {
  validate(value, _room, path) {
    if (typeof value !== 'string' || !backdrops.has(value)) {
      throw new Error(`${path}: unknown backdrop "${String(value)}"`);
    }
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

/**
 * The camera never shows a room's bottom 16px — PlayScene reserves them
 * as a cropped basement so ground reads as a lip of stone instead of a
 * wall of rock (see setRoom's camera bounds). That is a CONTRACT: the
 * bottom two tile rows are scenery, and a floor the player can stand on
 * down there is ground the camera cannot reach — the knight walks along
 * the screen's bottom edge with her feet cut off.
 *
 * This was found live, not imagined: town's riven-flue shaft was dug
 * with a standable floor on the last row, and a knight dropping into
 * the choked shaft stood clipped at the frame's edge.
 *
 * One shape of basement floor is fine: a surface fully covered by an
 * unlock-free fall-in door. That seam fires mid-fall, every time, so
 * the surface below it is pure pass-through — nobody can ever stand on
 * it. A LOCKABLE fall-in gives no such guarantee (locked = the shaft
 * catches you), which is exactly the case this rule exists to reject.
 */
function requireSolidBasement(room: RoomDef, path: string): void {
  const rows = room.tiles.length;
  if (rows < 4) return;
  const ts = room.tileSize;
  const solidAt = (r: number, c: number): boolean => {
    const id = room.legend[(room.tiles[r] ?? '')[c] ?? ''] ?? '';
    return id !== '' && !!tiles.get(id).solid;
  };
  const passThrough = (room.triggers ?? []).filter(
    (t) => t.event === 'door' && t.props?.fallIn === true
      && t.props.key === undefined && t.props.flag === undefined && t.props.bossSeal === undefined,
  );
  const cols = Math.max(...room.tiles.map((row) => row.length));
  for (let c = 0; c < cols; c++) {
    for (const r of [rows - 2, rows - 1]) {
      if (!solidAt(r, c) || solidAt(r - 1, c)) continue; // not a standing surface
      const covered = passThrough.some(
        (t) => c >= Math.floor(t.x / ts) && c <= Math.floor((t.x + t.w - 1) / ts),
      );
      if (!covered) {
        throw new Error(
          `${path}: standable floor at col ${c}, row ${r} sits in the camera's 16px basement reserve — `
          + 'fill the pit, deepen the room, or cover it with an unlock-free fall-in door',
        );
      }
    }
  }
}

/** Validate open content bags after all game registries have been filled. */
export function validateRoomContent(room: RoomDef, id = room.name): RoomDef {
  const root = `room "${id}"`;
  const roomProps = propsAt(room.props, `${root}.props`);
  for (const [key, value] of Object.entries(roomProps)) {
    if (!roomFeatures.has(key)) throw new Error(`${root}.props.${key}: unknown room feature`);
    roomFeatures.get(key).validate(value, room, `${root}.props.${key}`);
  }

  // The basement contract guards rooms a player will look at. The 'test'
  // slot is a scenario's inline lab bench — synthetic, camera-less in
  // spirit, and frozen verbatim inside existing recordings, so holding it
  // to a framing rule would invalidate every verb tape for no one's eyes.
  if (id !== 'test') requireSolidBasement(room, root);

  room.entities.forEach((entity, index) => {
    const path = `${root}.entities[${index}] (${entity.type}).props`;
    const props = propsAt(entity.props, path);
    if (placeables.has(entity.type)) placeables.get(entity.type).validateProps?.(props, path);
  });

  (room.triggers ?? []).forEach((trigger, index) => {
    // Loud, not silent: a missing provider means the trigger-actions
    // module never loaded, and skipping validation here would let a
    // malformed room slide through to fail mid-play instead.
    if (!triggerValidators) {
      throw new Error(`${root}: trigger validation unavailable — scenes/play/trigger-actions has not loaded`);
    }
    const path = `${root}.triggers[${index}] (${trigger.event}).props`;
    // `assemble` is scene infrastructure valid on ANY trigger — in co-op
    // it holds the firing until every knight has gathered (critical
    // cutscenes, boss intros). Validated once here and hidden from the
    // per-event validators, which each keep their own strict prop list.
    const { assemble, ...props } = propsAt(trigger.props, path);
    if (assemble !== undefined && typeof assemble !== 'boolean') {
      throw new Error(`${path}.assemble: expected a boolean`);
    }
    if (triggerValidators.has(trigger.event)) triggerValidators.get(trigger.event).validateProps?.(props, path);
    if (trigger.event === 'door') requireReachable(room, trigger, `${root}.triggers[${index}]`);
  });
  return room;
}
