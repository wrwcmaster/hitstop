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

/**
 * Put a body somewhere, legally.
 *
 * Assigning `.x`/`.y` is not physics: `moveAndCollide` only ever resolves
 * a body moving INTO a solid from outside, so one that STARTS inside is
 * invisible to it — every overlap test is already true, no contact is
 * new, and it walks through stone as if the wall were scenery. Anywhere
 * position was set by hand (room arrivals, spawns) could therefore put a
 * body somewhere movement would never have allowed, and nothing
 * downstream could tell.
 *
 * So placement resolves too. The push per direction is the MAXIMUM over
 * every overlapping solid, which is what clears a contiguous run of
 * tiles in one move — pushing out of one tile at a time just shoves the
 * body into its neighbour and the two fight. Then take the shortest of
 * the four, and repeat, because leaving one span can enter another.
 *
 * Returns false if it could not find open space, so a caller with a
 * fallback (a room's spawn point) can use it rather than trust a lie.
 */
export function placeBody(
  b: Body,
  x: number,
  y: number,
  world: CollisionSource,
  maxPasses = 4,
): boolean {
  b.x = x;
  b.y = y;
  for (let pass = 0; pass < maxPasses; pass++) {
    let hit = false;
    let outLeft = 0;
    let outRight = 0;
    let outUp = 0;
    let outDown = 0;
    for (const s of world.solidsNear(b)) {
      if (s.oneWay) continue;
      if (!(b.x < s.x + s.w && b.x + b.w > s.x && b.y < s.y + s.h && b.y + b.h > s.y)) continue;
      hit = true;
      outRight = Math.max(outRight, s.x + s.w - b.x);
      outLeft = Math.max(outLeft, b.x + b.w - s.x);
      outDown = Math.max(outDown, s.y + s.h - b.y);
      outUp = Math.max(outUp, b.y + b.h - s.y);
    }
    if (!hit) return true;
    const shortest = Math.min(outLeft, outRight, outUp, outDown);
    if (shortest === outUp) b.y -= outUp;
    else if (shortest === outDown) b.y += outDown;
    else if (shortest === outLeft) b.x -= outLeft;
    else b.x += outRight;
  }
  // Still buried after several passes: the spot is solid rock, not a
  // near miss. Say so.
  for (const s of world.solidsNear(b)) {
    if (s.oneWay) continue;
    if (b.x < s.x + s.w && b.x + b.w > s.x && b.y < s.y + s.h && b.y + b.h > s.y) return false;
  }
  return true;
}

export function applyGravity(b: Body, dt: number): void {
  if (b.flies) return;
  b.vy += GRAVITY * dt;
  if (b.vy > MAX_FALL) b.vy = MAX_FALL;
}

/**
 * THE LAWS. One physics, no exceptions:
 *
 *  1. INTEGRATION — a body's position changes only by integrating its
 *     velocity through the mover below, and the mover is correct at any
 *     speed: it sweeps the path, so nothing passes through or ends
 *     inside a solid however fast it travels.
 *  2. PLACEMENT — the only other way a body acquires a position is
 *     `placeBody`, which resolves overlap the way the mover would have.
 *     A body may only be put where a body could have moved.
 *  3. IMPULSE — mechanisms (jumps, kicks, knockback, being swallowed,
 *     cutscene holds, platform carries) express themselves as velocity
 *     or as a swept carry, never by assigning position.
 *  4. PRESENTATION — shakes, shivers and bobs are render offsets; they
 *     never touch the coordinates physics reads.
 *
 * (Net replication mirrors the host's authoritative simulation and is
 * exempt: it copies the results of this physics, it is not a second one.)
 */

/**
 * Sweep one X step: how far toward `b.x + dx` the body may travel, and
 * what stopped it. Reads geometry only — mutates nothing.
 *
 * The path rect (not the body rect) is what gets queried: a fast step
 * must see every solid it would cross, not just the ones beside it.
 */
function sweepX(
  b: Body,
  dx: number,
  world: CollisionSource,
): { stop: number; solid: Solid | null } {
  let stop = b.x + dx;
  let hit: Solid | null = null;
  if (dx === 0) return { stop, solid: null };
  const path: Rect = { x: Math.min(b.x, stop), y: b.y, w: b.w + Math.abs(dx), h: b.h };
  for (const s of world.solidsNear(path)) {
    if (s.oneWay) continue;
    if (!(b.y < s.y + s.h && b.y + b.h > s.y)) continue;
    const startOverlap = b.x < s.x + s.w && b.x + b.w > s.x;
    // A body overlapping a STATIC solid before it moves is a placement
    // fault, and placement law (placeBody) is the cure. The mover does
    // not guess its way out — ejecting by velocity sign is how a buried
    // body used to "walk through" a wall one tile face at a time.
    if (startOverlap && !s.dynamic) continue;
    if (s.dynamic) {
      // A moving solid may have entered the body between its updates.
      // When the intrusion is shallower vertically, leave it for the Y
      // pass; treating it as a wall would eject a jumper sideways from
      // beneath a descending platform.
      const ox = Math.min(b.x + dx + b.w, s.x + s.w) - Math.max(b.x + dx, s.x);
      const oy = Math.min(b.y + b.h, s.y + s.h) - Math.max(b.y, s.y);
      if (ox > 0 && oy < ox) continue;
    }
    if (dx > 0) {
      if (!startOverlap && s.x + s.w <= b.x + b.w) continue; // behind or beside
      const c = s.x - b.w;
      if (c < stop) {
        stop = c;
        hit = s;
      }
    } else {
      if (!startOverlap && s.x >= b.x) continue;
      const c = s.x + s.w;
      if (c > stop) {
        stop = c;
        hit = s;
      }
    }
  }
  return { stop, solid: hit };
}

/** Sweep one Y step. Same contract as sweepX, plus one-way platforms. */
function sweepY(
  b: Body,
  dy: number,
  world: CollisionSource,
  opts: { ignoreOneWay?: boolean; dropThrough?: boolean },
): { stop: number; solid: Solid | null; side: 'ground' | 'ceiling' | null } {
  let stop = b.y + dy;
  let hit: Solid | null = null;
  let side: 'ground' | 'ceiling' | null = null;
  const prevTop = b.y;
  const prevBottom = b.y + b.h;
  const path: Rect = { x: b.x, y: Math.min(b.y, stop), w: b.w, h: b.h + Math.abs(dy) };
  for (const s of world.solidsNear(path)) {
    if (!(b.x < s.x + s.w && b.x + b.w > s.x)) continue;
    if (s.oneWay) {
      if (opts.ignoreOneWay || opts.dropThrough) continue;
      // Land only when falling onto it from above (1px of grace for a
      // foot resting fractionally into the surface).
      if (dy > 0 && prevBottom <= s.y + 1) {
        const c = s.y - b.h;
        if (c < stop) {
          stop = c;
          hit = s;
          side = 'ground';
        }
      }
      continue;
    }
    const wasOverlapping = prevTop < s.y + s.h && prevBottom > s.y;
    if (wasOverlapping && !s.dynamic) continue; // placement law's jurisdiction
    if (wasOverlapping) {
      // A dynamic solid moved into the body since its last update, so
      // velocity cannot identify the contacted side. Preserve the side
      // the body already occupied: a descending platform keeps a player
      // below it instead of teleporting them onto its top.
      //
      // Depenetration is a BOUND on where the body may end up, never a
      // replacement for where it was going. Assigning the face outright
      // discards the step the body just integrated, so a platform that
      // keeps re-touching a body every frame keeps re-parking it at the
      // same face — the body reads as glued to the platform and travels
      // at its speed instead of its own. Clamped instead, a body already
      // clear of the face on its own keeps its position, and one still
      // inside is pushed just far enough to be out.
      if (prevTop + b.h / 2 < s.y + s.h / 2) {
        const c = s.y - b.h;
        if (c < stop) {
          stop = c;
          hit = s;
          side = 'ground';
        }
      } else {
        const c = s.y + s.h;
        if (c > stop) {
          stop = c;
          hit = s;
          side = 'ceiling';
        }
      }
      continue;
    }
    if (dy > 0 && prevBottom <= s.y) {
      const c = s.y - b.h;
      if (c < stop) {
        stop = c;
        hit = s;
        side = 'ground';
      }
    } else if (dy < 0 && prevTop >= s.y + s.h) {
      const c = s.y + s.h;
      if (c > stop) {
        stop = c;
        hit = s;
        side = 'ceiling';
      }
    }
  }
  return { stop, solid: hit, side };
}

/**
 * Move a body and resolve collisions against a collision source.
 * Axis-separated swept AABB: X first (walls), then Y (floor/ceiling).
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

  // X axis. Fliers collide here too: flying means ignoring the ground,
  // not phasing through rock.
  const xr = sweepX(b, b.vx * dt, world);
  if (xr.solid) {
    // The blocked side is the side the body was traveling toward; dx = 0
    // produces no hit, so the sign is always meaningful here.
    if (b.vx > 0) addContact('right', xr.solid, { x: -1, y: 0 }, b.vx);
    else addContact('left', xr.solid, { x: 1, y: 0 }, b.vx);
  }
  b.x = xr.stop;
  if (xr.solid) b.vx = 0;

  // Y axis
  const yr = sweepY(b, b.vy * dt, world, opts);
  b.y = yr.stop;
  b.onGround = false;
  // A contact cancels the velocity INTO the surface, and nothing else.
  //
  // Zeroing vy outright reads as the same thing while every contact comes
  // from the body's own motion — you only meet a ceiling going up. It
  // stops being the same thing once a DYNAMIC solid can arrive at a body
  // that was not moving toward it: a descending platform pushes whoever
  // is under it downward and, with an unconditional reset, deletes their
  // fall on the way. Gravity re-earns a few px/s, the platform overlaps
  // them again next frame, and the reset lands again — so the body never
  // outpaces the platform and rides its underside down, glued to it.
  // Cancelling only the component pointing into the surface leaves the
  // fall intact, and the body separates the moment it drops faster than
  // the platform descends.
  if (yr.solid && yr.side === 'ground') {
    addContact('ground', yr.solid, { x: 0, y: -1 }, b.vy);
    if (b.vy > 0) b.vy = 0;
    b.onGround = true;
  } else if (yr.solid && yr.side === 'ceiling') {
    addContact('ceiling', yr.solid, { x: 0, y: 1 }, b.vy);
    if (b.vy < 0) b.vy = 0;
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

/**
 * Carry a body by a displacement that is not its own — a platform moving
 * whoever stands on it. The same sweeps as the mover, so a carry is
 * stopped by walls exactly like a walk would be; what it does NOT do is
 * touch velocity or contacts, because the ride is the platform's motion,
 * not the rider's, and the rider's own move this frame still happens.
 */
export function carryBody(b: Body, dx: number, dy: number, world: CollisionSource): void {
  b.x = sweepX(b, dx, world).stop;
  b.y = sweepY(b, dy, world, {}).stop;
  const lvl = world.bounds;
  if (lvl) {
    b.x = Math.min(Math.max(b.x, lvl.x), lvl.x + lvl.w - b.w);
    b.y = Math.min(Math.max(b.y, lvl.y), lvl.y + lvl.h - b.h);
  }
}
