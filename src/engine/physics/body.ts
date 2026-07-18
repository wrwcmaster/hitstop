import { Rect } from '../math/rect';

/** A solid rectangle in the world. `oneWay` = platform you can jump through. */
export interface Solid extends Rect {
  oneWay?: boolean;
}

/** Anything that can report solids near a rect (tilemaps, rect lists...). */
export interface CollisionSource {
  solidsNear(r: Rect): Iterable<Solid>;
  /** Horizontal world extent, used to clamp bodies inside the room. */
  worldW: number;
  /** Fraction (0..1) of a rect covered by water, if this source has any
   * (tilemaps do). Absent = a dry world. */
  submersion?(r: Rect): number;
}

/** A moving AABB. Position is top-left; velocities in px/s. */
export interface Body extends Rect {
  vx: number;
  vy: number;
  onGround: boolean;
  /** Flying bodies skip gravity and horizontal wall pushes (bats, ghosts). */
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
): void {
  // X axis
  b.x += b.vx * dt;
  if (!b.flies) {
    for (const s of world.solidsNear(b)) {
      if (s.oneWay) continue;
      if (b.x < s.x + s.w && b.x + b.w > s.x && b.y < s.y + s.h && b.y + b.h > s.y) {
        if (b.vx > 0) b.x = s.x - b.w;
        else if (b.vx < 0) b.x = s.x + s.w;
        b.vx = 0;
      }
    }
  }

  // Y axis
  const prevBottom = b.y + b.h;
  b.y += b.vy * dt;
  b.onGround = false;
  for (const s of world.solidsNear(b)) {
    if (!(b.x < s.x + s.w && b.x + b.w > s.x && b.y < s.y + s.h && b.y + b.h > s.y)) continue;
    if (s.oneWay) {
      const landing = b.vy > 0 && prevBottom <= s.y + 1;
      if (landing && !opts.ignoreOneWay && !opts.dropThrough) {
        b.y = s.y - b.h;
        b.vy = 0;
        b.onGround = true;
      }
    } else {
      if (b.vy > 0) {
        b.y = s.y - b.h;
        b.vy = 0;
        b.onGround = true;
      } else if (b.vy < 0) {
        b.y = s.y + s.h;
        b.vy = 0;
      }
    }
  }

  // Keep bodies inside the room horizontally.
  if (b.x < 0) {
    b.x = 0;
    if (b.vx < 0) b.vx = 0;
  }
  if (b.x + b.w > world.worldW) {
    b.x = world.worldW - b.w;
    if (b.vx > 0) b.vx = 0;
  }
}
