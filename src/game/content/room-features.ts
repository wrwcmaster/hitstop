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
function requireReachable(room: RoomDef, doors: TriggerDef[], path: string): void {
  const ts = room.tileSize;
  const cols = Math.max(...room.tiles.map((r) => r.length));
  const rows = room.tiles.length;
  const solid = (x: number, y: number): boolean => {
    const c = Math.floor(x / ts);
    const r = Math.floor(y / ts);
    if (c < 0 || r < 0 || c >= cols || r >= rows) return true;
    const id = room.legend[(room.tiles[r] ?? '')[c] ?? ''] ?? '';
    if (id === '') return false;
    const def = tiles.get(id);
    // Breakable stone is a door with extra steps, not a wall: the riven
    // dig site is sealed under a cracked cap until an Impact Drop opens
    // it. Counting it as passable is what keeps this rule about geometry
    // that can never yield, rather than about what the knight has earned.
    if (def.traits?.includes('breakable')) return false;
    return !!def.solid;
  };
  // A knight-sized box, sampled on a 2px lattice — fine enough that no
  // 8px tile can hide between samples.
  const W = 14;
  const H = 18;
  const free = (x: number, y: number): boolean => {
    if (x < 0 || y < 0 || x + W > cols * ts || y + H > rows * ts) return false;
    for (let dx = 0; dx < W; dx += 2) {
      for (let dy = 0; dy < H; dy += 2) if (solid(x + dx, y + dy)) return false;
    }
    return true;
  };
  // Free flight from the spawn: no gravity, no jump limit. That is far
  // more generous than the knight really is, which is the point —
  // anything THIS cannot reach is unreachable beyond argument, so the
  // rule never fails a room over a jump that is merely hard.
  const step = 2;
  const seen = new Set<number>();
  const key = (x: number, y: number): number => y * cols * ts + x;
  const start: [number, number] = [room.playerSpawn.x, room.playerSpawn.y];
  const queue: [number, number][] = [start];
  seen.add(key(...start));
  while (queue.length) {
    const [x, y] = queue.pop()!;
    for (const [nx, ny] of [[x + step, y], [x - step, y], [x, y + step], [x, y - step]] as [number, number][]) {
      if (seen.has(key(nx, ny)) || !free(nx, ny)) continue;
      seen.add(key(nx, ny));
      queue.push([nx, ny]);
    }
  }
  for (const door of doors) {
    let reached = false;
    for (const k of seen) {
      const x = k % (cols * ts);
      const y = (k - x) / (cols * ts);
      if (x < door.x + door.w && x + W > door.x && y < door.y + door.h && y + H > door.y) {
        reached = true;
        break;
      }
    }
    if (!reached) {
      throw new Error(
        `${path}: doorway to "${String(door.props?.room)}" cannot be reached from the spawn — `
        + 'its tiles may be clear, but no path of open space leads to them',
      );
    }
  }
}

/**
 * A column left open at the room's bottom edge has an INVISIBLE floor.
 * The physics backstop stops bodies at the room extent whether or not a
 * tile is drawn there, so the knight ends up standing on nothing — no
 * stone under her feet, at the very edge of the frame.
 *
 * This is a room bug at any camera setting, which is the whole reason
 * it outlived the 16px reserve it was first written against: that
 * constant cropped the bottom rows, so the invisible floor was also an
 * unseeable one. The crop is gone (rooms author their own foundation
 * now) and the rule is simply "draw the ground you stand on".
 *
 * One exemption: a column fully covered by an unlock-free fall-in door.
 * That seam fires mid-fall every time, so nobody can ever stand there.
 * A LOCKABLE fall-in gives no such guarantee — locked, the shaft
 * catches you — which is exactly the case this rejects.
 */
function requireDrawnFloor(room: RoomDef, path: string): void {
  const rows = room.tiles.length;
  if (rows < 2) return;
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
    if (solidAt(rows - 1, c)) continue;
    const covered = passThrough.some(
      (t) => c >= Math.floor(t.x / ts) && c <= Math.floor((t.x + t.w - 1) / ts),
    );
    if (!covered) {
      throw new Error(
        `${path}: col ${c} is open at the room's bottom edge — the physics backstop becomes an `
        + 'invisible floor there; draw ground in the last row or cover the column with an unlock-free fall-in door',
      );
    }
  }
}

/**
 * A fall-in seam is a passage you can only ever occupy while falling —
 * every rule around it (fire on downward motion, re-fire on a reversed
 * arc, land just inside the far lip) assumes transit. Give its shaft a
 * floor and a player can STAND inside a live seam, where those rules
 * turn absurd: hopping in place on solid ground teleports you through
 * the floor. Town's dig pocket shipped exactly that.
 *
 * The offending shape, under far-edge firing: a SOLID floor inside the
 * trigger band. The seam fires when the body's motion crosses the
 * band's far edge, so solid ground in the band stops the fall short of
 * the plane and the door simply never fires — a passage that dead-ends
 * in silence. Ground below the plane is unreachable (the crossing fires
 * first), ground above the band is the shaft's own lip (the breakable
 * cap), and ONE-WAY ledges anywhere are legal by the same physics:
 * they catch a descent, and drop-through resumes it — a rest, not a
 * blockage. LOCKED fall-ins are the opposite shape by design (the
 * shaft catches you while the way is shut, like the rubble-choked
 * flue) — being caught is the point.
 */
function requirePassThroughShaft(room: RoomDef, path: string): void {
  const ts = room.tileSize;
  const solidAt = (r: number, c: number): boolean => {
    const id = room.legend[(room.tiles[r] ?? '')[c] ?? ''] ?? '';
    return id !== '' && !!tiles.get(id).solid;
  };
  for (const door of room.triggers ?? []) {
    if (door.event !== 'door' || door.props?.fallIn !== true) continue;
    if (door.props.key !== undefined || door.props.flag !== undefined || door.props.bossSeal !== undefined) continue;
    const c0 = Math.floor(door.x / ts);
    const c1 = Math.floor((door.x + door.w - 1) / ts);
    const r0 = Math.floor(door.y / ts);
    const r1 = Math.floor((door.y + door.h - 1) / ts);
    for (let c = c0; c <= c1; c++) {
      for (let r = Math.max(0, r0); r <= r1; r++) {
        if (solidAt(r, c)) {
          throw new Error(
            `${path}: solid ground at col ${c}, row ${r} sits inside the fall-in band to "${String(door.props.room)}" — `
            + 'the fall can never reach the seam plane there; open the shaft or lock the door while a floor exists',
          );
        }
      }
    }
  }
}

/**
 * The placement law, enforced at authoring time: an entity must not be
 * born overlapping solid rock. The engine's placeBody would shove it to
 * the nearest open face at spawn, but a silent shove is the room lying
 * about where its furniture is — grotto shipped a chest entombed in a
 * rock pillar that "rested" inside the stone for as long as the old
 * mover happened to bury it stably. Flush contact is legal (a chest ON
 * a floor, a rockfall hanging FROM a ceiling); strict overlap is not.
 * One-ways don't bury anything — a body inside one falls free.
 */
function requireUnburiedEntities(room: RoomDef, path: string): void {
  const ts = room.tileSize;
  const buriedIn = (r: number, c: number): boolean => {
    const id = room.legend[(room.tiles[r] ?? '')[c] ?? ''] ?? '';
    if (id === '') return false;
    const def = tiles.get(id);
    return !!def.solid && !def.oneWay;
  };
  (room.entities ?? []).forEach((e, i) => {
    if (!placeables.has(e.type)) return; // unknown types fail loudly elsewhere
    const p = placeables.get(e.type);
    const c0 = Math.floor(e.x / ts);
    const c1 = Math.ceil((e.x + p.w) / ts) - 1;
    const r0 = Math.floor(e.y / ts);
    const r1 = Math.ceil((e.y + p.h) / ts) - 1;
    for (let r = Math.max(0, r0); r <= r1; r++) {
      for (let c = Math.max(0, c0); c <= c1; c++) {
        if (buriedIn(r, c)) {
          throw new Error(
            `${path}.entities[${i}] (${e.type}): body ${p.w}x${p.h} at (${e.x},${e.y}) overlaps solid tile at col ${c}, row ${r} — `
            + 'entities must be placed where a body could stand, not inside rock',
          );
        }
      }
    }
  });
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
  if (id !== 'test') requireDrawnFloor(room, root);
  if (id !== 'test') requirePassThroughShaft(room, root);
  if (id !== 'test') requireUnburiedEntities(room, root);

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
    // A trigger fires once unless it says otherwise, and a one-shot door
    // welds itself shut: it fires, is recorded into the save as spent,
    // and every later visit finds it dead. Underground's vault door
    // shipped exactly that — omitted `once`, worked exactly once per
    // save. Passages must always declare themselves repeating.
    if ((trigger.event === 'door' || trigger.event === 'portal') && trigger.once !== false) {
      throw new Error(`${root}.triggers[${index}]: a ${trigger.event} must declare "once": false — a one-shot passage welds itself shut after first use`);
    }
  });

  // One flood fill answers for every door at once, rather than per door.
  const doors = (room.triggers ?? []).filter((t) => t.event === 'door');
  if (doors.length) requireReachable(room, doors, root);
  return room;
}
