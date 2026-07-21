/**
 * The explored-world map: a grid of placed regions, drawn metroidvania
 * style — you see where you have been, where you are, and the shape of
 * how it joins up.
 *
 * The mechanism here is deliberately dumb: it knows about cells on a
 * grid and which of them are explored. It has no idea what a "room" is,
 * where exploration state is kept, or how regions connect — the caller
 * supplies placement, an `explored` predicate, and any links. That keeps
 * the same widget usable for a castle, an overworld, or a dungeon floor.
 *
 * One deliberate choice: the map is always scaled to the FULL extent of
 * the world, not to the part discovered so far. A map that re-scales and
 * re-centres itself as you explore is disorienting — landmarks slide
 * around between visits. Fixing the frame means a room you have seen
 * stays exactly where you remember it, and the blank space around it
 * honestly reads as "there is more out there".
 */

/** One placed region, in grid cells. */
export interface WorldMapCell {
  id: string;
  x: number;
  y: number;
  /** Span in cells (default 1x1) — a large region can occupy several. */
  w?: number;
  h?: number;
}

export interface WorldMapStyle {
  /** Fill for a region the player has been to. */
  explored: string;
  /** Fill for the region they are standing in. */
  current: string;
  border: string;
  /** Connections between explored regions. */
  link: string;
  /** Faint marker for un-entered regions; omit to hide them entirely. */
  unexplored?: string;
}

export const DEFAULT_WORLD_MAP_STYLE: WorldMapStyle = {
  explored: '#33447f',
  current: '#ffcd75',
  border: '#94b0c2',
  link: '#566c86',
};

export interface WorldMapOpts {
  /** Screen-space box to fit the whole map inside. */
  box: { x: number; y: number; w: number; h: number };
  explored(id: string): boolean;
  /** Region the player occupies, highlighted. */
  current?: string | null;
  /** Region pairs to join with a line, drawn when both ends are explored. */
  links?: readonly (readonly [string, string])[];
  style?: Partial<WorldMapStyle>;
  /** Gap between cells, in screen px (default 1). */
  gap?: number;
}

/**
 * Draw the map, fitted and centred inside `opts.box`. Returns the cell
 * size actually used, so callers can place their own overlays (icons,
 * labels) on the same grid.
 */
export function drawWorldMap(
  g: CanvasRenderingContext2D,
  cells: readonly WorldMapCell[],
  opts: WorldMapOpts,
): number {
  if (!cells.length) return 0;
  const style = { ...DEFAULT_WORLD_MAP_STYLE, ...opts.style };
  const gap = opts.gap ?? 1;
  const { box } = opts;

  // Full extent, explored or not — see the note above on a fixed frame.
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const c of cells) {
    minX = Math.min(minX, c.x);
    minY = Math.min(minY, c.y);
    maxX = Math.max(maxX, c.x + (c.w ?? 1));
    maxY = Math.max(maxY, c.y + (c.h ?? 1));
  }
  const cols = maxX - minX;
  const rows = maxY - minY;
  // Whole-pixel cells keep the grid crisp at this resolution.
  const size = Math.max(2, Math.floor(Math.min(box.w / cols, box.h / rows)));
  const originX = Math.round(box.x + (box.w - cols * size) / 2);
  const originY = Math.round(box.y + (box.h - rows * size) / 2);

  const rectOf = (c: WorldMapCell) => ({
    x: originX + (c.x - minX) * size,
    y: originY + (c.y - minY) * size,
    w: (c.w ?? 1) * size,
    h: (c.h ?? 1) * size,
  });
  const byId = new Map(cells.map((c) => [c.id, c]));

  // Links first, so cells sit on top of their own connections.
  if (opts.links?.length) {
    g.strokeStyle = style.link;
    g.lineWidth = 1;
    for (const [a, b] of opts.links) {
      const ca = byId.get(a);
      const cb = byId.get(b);
      if (!ca || !cb || !opts.explored(a) || !opts.explored(b)) continue;
      const ra = rectOf(ca);
      const rb = rectOf(cb);
      g.beginPath();
      g.moveTo(Math.round(ra.x + ra.w / 2) + 0.5, Math.round(ra.y + ra.h / 2) + 0.5);
      g.lineTo(Math.round(rb.x + rb.w / 2) + 0.5, Math.round(rb.y + rb.h / 2) + 0.5);
      g.stroke();
    }
  }

  for (const c of cells) {
    const seen = opts.explored(c.id);
    if (!seen && !style.unexplored) continue; // fog: never been, never shown
    const r = rectOf(c);
    g.fillStyle = !seen
      ? style.unexplored!
      : c.id === opts.current
        ? style.current
        : style.explored;
    g.fillRect(r.x + gap, r.y + gap, r.w - gap * 2, r.h - gap * 2);
    if (seen) {
      g.strokeStyle = style.border;
      g.lineWidth = 1;
      g.strokeRect(r.x + gap + 0.5, r.y + gap + 0.5, r.w - gap * 2 - 1, r.h - gap * 2 - 1);
    }
  }
  return size;
}
