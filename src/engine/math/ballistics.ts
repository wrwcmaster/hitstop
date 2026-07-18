/**
 * Ballistic aim solvers — the math for anything that arcs under
 * gravity: arrows, lobbed globs, thrown rocks. Pure functions; both
 * players' weapons and monster AI aim through these.
 */

export interface Velocity {
  vx: number;
  vy: number;
}

/**
 * Solve the launch velocity to hit a point `dx,dy` away (dy positive =
 * below) at a fixed muzzle `speed` under `gravity`. Picks the flatter
 * of the two solutions (the "direct" shot). Returns null when the
 * target is out of range at that speed.
 *
 * With gravity 0 it degenerates to a straight shot at `speed`.
 */
export function ballisticVelocity(
  dx: number,
  dy: number,
  speed: number,
  gravity: number,
): Velocity | null {
  if (gravity === 0) {
    const d = Math.hypot(dx, dy) || 1;
    return { vx: (dx / d) * speed, vy: (dy / d) * speed };
  }
  // Classic projectile aiming: tan θ = (v² ± √(v⁴ − g(gx² + 2yv²))) / gx
  // with y measured upward, so flip dy.
  const g = gravity;
  const v2 = speed * speed;
  const y = -dy;
  const x = Math.abs(dx);
  if (x < 0.001) {
    // Straight up/down: reachable if the speed can climb that high.
    if (y > 0 && v2 < 2 * g * y) return null;
    return { vx: 0, vy: y > 0 ? -speed : speed };
  }
  const disc = v2 * v2 - g * (g * x * x + 2 * y * v2);
  if (disc < 0) return null;
  const tan = (v2 - Math.sqrt(disc)) / (g * x); // minus root = low arc
  const angle = Math.atan(tan);
  const dir = Math.sign(dx) || 1;
  return {
    vx: dir * speed * Math.cos(angle),
    vy: -speed * Math.sin(angle),
  };
}

/**
 * An always-solvable lob: rise `apex` px above the launch point (at
 * least clearing the target), then fall onto `dx,dy`. Speed comes out
 * of the solve instead of going in — mortar-style, never "out of
 * range", just slower or faster arcs. Gravity must be positive.
 */
export function ballisticLob(
  dx: number,
  dy: number,
  gravity: number,
  apex: number,
): Velocity {
  const g = Math.max(1, gravity);
  // Apex must clear both endpoints (dy positive = target below).
  const rise = Math.max(apex, apex - dy);
  const vy = -Math.sqrt(2 * g * rise);
  // Total flight time: up to the apex, then down to the target's height.
  const tUp = -vy / g;
  const fall = Math.max(1, rise + dy);
  const tDown = Math.sqrt((2 * fall) / g);
  const t = tUp + tDown;
  return { vx: dx / t, vy };
}
