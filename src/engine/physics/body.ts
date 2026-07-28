import { Rect } from '../math/rect';

/** A solid rectangle in the world. `oneWay` = platform you can jump through. */
export interface Solid extends Rect {
  oneWay?: boolean;
  /** Runtime-moving/toggling solid (moving platform, barrier...). Static
   * tile solids omit this. Resolution is identical either way; contact
   * consumers use the bit to react to the surface appropriately. */
  dynamic?: boolean;
}

/** Axis-aligned normal pointing from the contacted solid toward the body. */
export interface CollisionNormal {
  x: -1 | 0 | 1;
  y: -1 | 0 | 1;
}

/** One surface contact produced while resolving a movement step. */
export interface CollisionContact {
  /** Exact object returned by the CollisionSource, preserving the identity
   * of dynamic solids across frames. */
  solid: Solid;
  normal: CollisionNormal;
  /** Signed velocity on the resolved axis immediately before impact. */
  impactVelocity: number;
  oneWay: boolean;
  dynamic: boolean;
  /** True for the level-extent backstop rather than an authored solid. */
  boundary: boolean;
}

/**
 * Contacts produced by one move. Direction names describe the BODY side that
 * was blocked: `right` is a wall against its right side, `ground` its feet.
 */
export interface CollisionResult {
  contacts: CollisionContact[];
  left: CollisionContact | null;
  right: CollisionContact | null;
  ceiling: CollisionContact | null;
  ground: CollisionContact | null;
}

/** Anything that can report solids near a rect (tilemaps, rect lists...). */
export interface CollisionSource {
  solidsNear(r: Rect): Iterable<Solid>;
  /**
   * The level's extent, if it has one. Solid tiles do the real
   * containment work; this is what "inside the level" means for the
   * things that need to know — bodies are kept within it, and things
   * that travel out of it (projectiles) use it to tell they're gone.
   * Omit it for an unbounded world and nothing is clamped.
   */
  bounds?: Rect;
  /** Fraction (0..1) of a rect covered by water, if this source has any
   * (tilemaps do). Absent = a dry world. */
  submersion?(r: Rect): number;
  /**
   * Is this exact point water? The point-sized companion to `submersion`,
   * for probing a line rather than weighing an area — finding the
   * waterline a flier should stay above, say.
   *
   * Declared here because it was already being used: callers cast the
   * collision source to reach a method the seam did not admit to having,
   * which is a dependency either way, just an unchecked one.
   */
  waterAt?(x: number, y: number): boolean;
  /** Strongest hazard-tile damage under a rect (spikes, lava). Absent =
   * a harmless world. */
  hazardAt?(r: Rect): number;
  /**
   * Does any tile under a rect carry a content trait? The engine keeps
   * assigning no meaning to trait ids; this is only the spatial lookup,
   * so a controller can ask what KIND of surface it is touching (a wall
   * too slick to grip, stone that rings) without owning the tilemap.
   * Absent = a world with no traits to speak of.
   */
  traitAt?(r: Rect, trait: string): boolean;
}

/** A moving AABB. Position is top-left; velocities in px/s. */
export interface Body extends Rect {
  vx: number;
  vy: number;
  onGround: boolean;
  /** Latest movement contacts. `moveAndCollide` writes this as well as
   * returning it, so debug tooling and controllers can inspect either seam. */
  lastCollision?: CollisionResult;
  /** Flying bodies skip gravity (bats, ghosts). They still collide with
   * solids on both axes — flying means ignoring the ground, not phasing
   * through rock. */
  flies?: boolean;
}

export const GRAVITY = 1500;
export const MAX_FALL = 460;

export function applyGravity(b: Body, dt: number): void {
  if (b.flies) return;
  b.vy += GRAVITY * dt;
  if (b.vy > MAX_FALL) b.vy = MAX_FALL;
}

/**
 * Move a body and resolve collisions against a collision source.
 * Axis-separated AABB sweep: X first (walls), then Y (floor/ceiling).
 * One-way platforms only collide when falling onto them from above,
 * and can be dropped through with `dropThrough`.
 */
export function moveAndCollide(
  b: Body,
  dt: number,
  world: CollisionSource,
  opts: { ignoreOneWay?: boolean; dropThrough?: boolean } = {},
): CollisionResult {
  const result: CollisionResult = {
    contacts: [],
    left: null,
    right: null,
    ceiling: null,
    ground: null,
  };
  const addContact = (
    side: 'left' | 'right' | 'ceiling' | 'ground',
    solid: Solid,
    normal: CollisionNormal,
    impactVelocity: number,
    boundary = false,
  ): void => {
    const contact: CollisionContact = {
      solid,
      normal,
      impactVelocity,
      oneWay: solid.oneWay === true,
      dynamic: solid.dynamic === true,
      boundary,
    };
    result.contacts.push(contact);
    result[side] = contact;
  };

  // X axis. Fliers collide here too: letting them drift into rock left
  // them embedded in a wall, and the Y pass below would then "land" them
  // on top of the topmost wall tile — outside the room entirely.
  b.x += b.vx * dt;
  for (const s of world.solidsNear(b)) {
    if (s.oneWay) continue;
    if (b.x < s.x + s.w && b.x + b.w > s.x && b.y < s.y + s.h && b.y + b.h > s.y) {
      const overlapX = Math.min(b.x + b.w, s.x + s.w) - Math.max(b.x, s.x);
      const overlapY = Math.min(b.y + b.h, s.y + s.h) - Math.max(b.y, s.y);
      // A moving solid may have entered the body between its updates. When
      // that intrusion is shallower vertically, leave it for the Y pass;
      // treating it as a wall would eject a jumper sideways from beneath a
      // descending platform.
      if (s.dynamic && overlapY < overlapX) continue;
      if (b.vx > 0) {
        addContact('right', s, { x: -1, y: 0 }, b.vx);
        b.x = s.x - b.w;
      } else if (b.vx < 0) {
        addContact('left', s, { x: 1, y: 0 }, b.vx);
        b.x = s.x + s.w;
      }
      b.vx = 0;
    }
  }

  // Y axis
  const prevTop = b.y;
  const prevBottom = b.y + b.h;
  b.y += b.vy * dt;
  b.onGround = false;
  for (const s of world.solidsNear(b)) {
    if (!(b.x < s.x + s.w && b.x + b.w > s.x && b.y < s.y + s.h && b.y + b.h > s.y)) continue;
    if (s.oneWay) {
      const landing = b.vy > 0 && prevBottom <= s.y + 1;
      if (landing && !opts.ignoreOneWay && !opts.dropThrough) {
        addContact('ground', s, { x: 0, y: -1 }, b.vy);
        b.y = s.y - b.h;
        b.vy = 0;
        b.onGround = true;
      }
    } else {
      const wasOverlapping = prevTop < s.y + s.h && prevBottom > s.y;
      // If a dynamic solid moved into the body since the previous body
      // update, velocity alone cannot identify the contacted side. Preserve
      // the side the body already occupied so a descending platform keeps a
      // player below it instead of teleporting them onto its top.
      const dynamicOverlap = s.dynamic === true && wasOverlapping;
      const resolveGround = dynamicOverlap
        ? prevTop + b.h / 2 < s.y + s.h / 2
        : b.vy > 0;
      if (resolveGround) {
        addContact('ground', s, { x: 0, y: -1 }, b.vy);
        b.y = s.y - b.h;
        b.vy = 0;
        b.onGround = true;
      } else if (b.vy < 0 || dynamicOverlap) {
        addContact('ceiling', s, { x: 0, y: 1 }, b.vy);
        b.y = s.y + s.h;
        b.vy = 0;
      }
    }
  }

  // Backstop: keep the body inside the level's extent. Solids do the real
  // containment (a room walls itself in with tiles); this catches anything
  // that ends up outside them — and an unbounded source clamps nothing.
  const lvl = world.bounds;
  if (lvl) {
    if (b.x < lvl.x) {
      addContact(
        'left',
        { x: lvl.x, y: lvl.y, w: 0, h: lvl.h },
        { x: 1, y: 0 },
        b.vx,
        true,
      );
      b.x = lvl.x;
      if (b.vx < 0) b.vx = 0;
    }
    if (b.x + b.w > lvl.x + lvl.w) {
      addContact(
        'right',
        { x: lvl.x + lvl.w, y: lvl.y, w: 0, h: lvl.h },
        { x: -1, y: 0 },
        b.vx,
        true,
      );
      b.x = lvl.x + lvl.w - b.w;
      if (b.vx > 0) b.vx = 0;
    }
    if (b.y < lvl.y) {
      addContact(
        'ceiling',
        { x: lvl.x, y: lvl.y, w: lvl.w, h: 0 },
        { x: 0, y: 1 },
        b.vy,
        true,
      );
      b.y = lvl.y;
      if (b.vy < 0) b.vy = 0;
    }
    if (b.y + b.h > lvl.y + lvl.h) {
      addContact(
        'ground',
        { x: lvl.x, y: lvl.y + lvl.h, w: lvl.w, h: 0 },
        { x: 0, y: -1 },
        b.vy,
        true,
      );
      b.y = lvl.y + lvl.h - b.h;
      if (b.vy > 0) b.vy = 0;
      // Standing on the level floor IS standing. This used to record the
      // contact and leave onGround false, so the two answers to "are my
      // feet on something" disagreed: contacts said yes, the flag said
      // no. Anything reading the flag — jumping, coyote time, the
      // landing animation — treated a body at rest as falling forever.
      b.onGround = true;
    }
  }
  b.lastCollision = result;
  return result;
}
