/** Axis-aligned rectangle. The engine's collision currency. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

export function containsPoint(r: Rect, x: number, y: number): boolean {
  return x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;
}

export function centerX(r: Rect): number {
  return r.x + r.w / 2;
}

export function centerY(r: Rect): number {
  return r.y + r.h / 2;
}

export function expand(r: Rect, by: number): Rect {
  return { x: r.x - by, y: r.y - by, w: r.w + by * 2, h: r.h + by * 2 };
}

/**
 * When a rect moving by (dx, dy) first touches `solid`, as a fraction of
 * the move — or null if it never does. The slab method: a hit needs both
 * axes overlapping at the same time, so the latest entry must come
 * before the earliest exit.
 *
 * This is what turns "something was in the way" into "here is where it
 * stopped". Without it a fast mover is only known to have hit, and gets
 * left wherever its step happened to end — which for a bullet is inside
 * or behind the wall it just struck.
 */
export function sweepEntry(from: Rect, dx: number, dy: number, solid: Rect): number | null {
  const axis = (
    p: number, size: number, sp: number, ssize: number, d: number,
  ): [number, number] | null => {
    if (d === 0) return p < sp + ssize && p + size > sp ? [-Infinity, Infinity] : null;
    const near = (d > 0 ? sp - (p + size) : sp + ssize - p) / d;
    const far = (d > 0 ? sp + ssize - p : sp - (p + size)) / d;
    return [near, far];
  };
  const xa = axis(from.x, from.w, solid.x, solid.w, dx);
  const ya = axis(from.y, from.h, solid.y, solid.h, dy);
  if (!xa || !ya) return null;
  const entry = Math.max(xa[0], ya[0]);
  const exit = Math.min(xa[1], ya[1]);
  if (entry > exit || entry > 1) return null;
  return entry <= 0 ? 0 : entry;
}

/**
 * The smallest rect containing both — the region a small body swept
 * while moving from one to the other. Exact for axis-aligned travel and
 * conservative on a diagonal (it includes the corners the path missed),
 * which is the safe direction for "did this pass through anything".
 */
export function union(a: Rect, b: Rect): Rect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    w: Math.max(a.x + a.w, b.x + b.w) - x,
    h: Math.max(a.y + a.h, b.y + b.h) - y,
  };
}
