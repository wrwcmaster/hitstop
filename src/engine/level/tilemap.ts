import { Rect } from '../math/rect';
import { Registry } from '../core/registry';
import { CollisionSource, Solid } from '../physics/body';

/**
 * A tile type. Registered by content; referenced by rooms via their legend.
 * Drawing is a callback so tiles can be flat colors, baked patterns, or
 * animated — the engine doesn't care.
 */
export interface TileDef {
  solid?: boolean;
  oneWay?: boolean;
  /** Content-owned physical labels. The engine stores and exposes them but
   * never assigns meaning to ids such as "breakable" or "resonant". */
  traits?: readonly string[];
  /** Swimmable liquid: non-solid, but bodies can query how deep they sit
   * in it (see Tilemap.submersion) for buoyancy/oxygen mechanics. */
  water?: boolean;
  /** Contact damage dealt to bodies overlapping this tile (spikes, lava).
   * Non-solid; the game decides who gets hurt and how often. */
  hazard?: number;
  /** Draw one tile at pixel position (px, py). (tx, ty) are tile coords for variation. */
  draw?(g: CanvasRenderingContext2D, px: number, py: number, size: number, tx: number, ty: number): void;
}

/** One registered tile at a specific grid/world position. */
export interface TileRef {
  tx: number;
  ty: number;
  id: string;
  def: TileDef;
  rect: Rect;
}

export type TileProbeDirection = 'left' | 'right' | 'up' | 'down';
export type SurfaceTraceStop = 'limit' | 'bounds' | 'gap' | 'wall' | 'blocked';

export interface SurfaceTraceOptions {
  /** Horizontal travel limit in world pixels, measured from the start tile. */
  maxDistance: number;
  /** Number of tile rows the trace may climb in one column. */
  stepUp?: number;
  /** Number of tile rows the trace may descend in one column. */
  stepDown?: number;
  /** Geometry that can provide a surface. Defaults to solid or one-way. */
  isSurface?: (tile: TileRef) => boolean;
  /** Content rule for whether the trace may enter a surface tile. */
  canTraverse?: (tile: TileRef) => boolean;
  /** Clearance rule for the tile above a surface. Defaults to non-solid. */
  isClear?: (tile: TileRef) => boolean;
}

export interface SurfaceTraceResult {
  /** Start tile followed by each connected tile, in deterministic order. */
  tiles: TileRef[];
  stop: SurfaceTraceStop;
}

/** Global registry of tile types (content registers into this). */
export const tiles = new Registry<TileDef>('tile');

/** Empty tile: always available. */
tiles.register('', {});

/**
 * A grid of tile ids with collision queries and rendering.
 * The map IS the collision world (plus any extra solids a room adds).
 */
export class Tilemap implements CollisionSource {
  readonly cols: number;
  readonly rows: number;
  /** Extra non-tile solids (moving platforms dock here later). */
  extraSolids: Solid[] = [];

  private grid: string[][];

  constructor(
    gridRows: string[][],
    public readonly tileSize: number,
  ) {
    this.grid = gridRows;
    this.rows = gridRows.length;
    this.cols = gridRows[0]?.length ?? 0;
  }

  get worldW(): number {
    return this.cols * this.tileSize;
  }

  get worldH(): number {
    return this.rows * this.tileSize;
  }

  /** The level's extent — what physics keeps bodies inside, and what
   * departing things (projectiles) measure themselves against. */
  get bounds(): Rect {
    return { x: 0, y: 0, w: this.worldW, h: this.worldH };
  }

  tileAt(tx: number, ty: number): string {
    if (tx < 0 || ty < 0 || tx >= this.cols || ty >= this.rows) return '';
    return this.grid[ty][tx];
  }

  /** Tile identity, definition, and world geometry at grid coordinates. */
  tileRef(tx: number, ty: number): TileRef | null {
    if (tx < 0 || ty < 0 || tx >= this.cols || ty >= this.rows) return null;
    const id = this.grid[ty][tx];
    return {
      tx,
      ty,
      id,
      def: tiles.get(id),
      rect: { x: tx * this.tileSize, y: ty * this.tileSize, w: this.tileSize, h: this.tileSize },
    };
  }

  /** Tile at a world-space point. Room edges outside the map return null. */
  tileAtPoint(x: number, y: number): TileRef | null {
    return this.tileRef(Math.floor(x / this.tileSize), Math.floor(y / this.tileSize));
  }

  /** Tiles touched by a world-space rectangle, in stable row-major order. */
  tilesOverlapping(r: Rect): TileRef[] {
    if (r.w <= 0 || r.h <= 0) return [];
    const ts = this.tileSize;
    const x0 = Math.max(0, Math.floor(r.x / ts));
    const y0 = Math.max(0, Math.floor(r.y / ts));
    const x1 = Math.min(this.cols - 1, Math.ceil((r.x + r.w) / ts) - 1);
    const y1 = Math.min(this.rows - 1, Math.ceil((r.y + r.h) / ts) - 1);
    if (x1 < x0 || y1 < y0) return [];
    const out: TileRef[] = [];
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        const tile = this.tileRef(tx, ty);
        if (tile) out.push(tile);
      }
    }
    return out;
  }

  /**
   * Tiles in the short strip immediately outside one side of a rectangle.
   * This is the common wall/floor sensing primitive; callers decide which
   * definitions or traits count as a useful hit.
   */
  probeTiles(r: Rect, direction: TileProbeDirection, distance: number): TileRef[] {
    const d = Number.isFinite(distance) ? Math.max(0, distance) : 0;
    if (d === 0 || r.w <= 0 || r.h <= 0) return [];
    switch (direction) {
      case 'left': return this.tilesOverlapping({ x: r.x - d, y: r.y, w: d, h: r.h });
      case 'right': return this.tilesOverlapping({ x: r.x + r.w, y: r.y, w: d, h: r.h });
      case 'up': return this.tilesOverlapping({ x: r.x, y: r.y - d, w: r.w, h: d });
      case 'down': return this.tilesOverlapping({ x: r.x, y: r.y + r.h, w: r.w, h: d });
    }
  }

  /**
   * Follow the exposed top of connected tiles one column at a time.
   * Geometry and ordering live here; content decides which tiles carry or
   * block a particular effect through predicates and generic traits.
   */
  traceSurface(start: TileRef, direction: -1 | 1, opts: SurfaceTraceOptions): SurfaceTraceResult {
    const surface = opts.isSurface ?? ((tile: TileRef) => tile.def.solid === true || tile.def.oneWay === true);
    const traverse = opts.canTraverse ?? (() => true);
    const clear = opts.isClear ?? ((tile: TileRef) => tile.def.solid !== true);
    const first = this.tileRef(start.tx, start.ty);
    if (!first || !surface(first) || !traverse(first)) return { tiles: [], stop: 'blocked' };

    const maxDistance = Number.isFinite(opts.maxDistance) ? Math.max(0, opts.maxDistance) : 0;
    const stepUp = Number.isFinite(opts.stepUp) ? Math.max(0, Math.floor(opts.stepUp!)) : 0;
    const stepDown = Number.isFinite(opts.stepDown) ? Math.max(0, Math.floor(opts.stepDown!)) : 0;
    const out = [first];
    let current = first;

    while (true) {
      const tx = current.tx + direction;
      if (Math.abs((tx - first.tx) * this.tileSize) > maxDistance) return { tiles: out, stop: 'limit' };
      if (tx < 0 || tx >= this.cols) return { tiles: out, stop: 'bounds' };

      const candidates = [current.ty];
      for (let n = 1; n <= stepUp; n++) candidates.push(current.ty - n);
      for (let n = 1; n <= stepDown; n++) candidates.push(current.ty + n);

      let next: TileRef | null = null;
      let foundWall = false;
      for (const ty of candidates) {
        const candidate = this.tileRef(tx, ty);
        if (!candidate || !surface(candidate)) continue;
        const above = this.tileRef(tx, ty - 1);
        if (!above || !clear(above)) {
          foundWall = true;
          continue;
        }
        next = candidate;
        break;
      }

      if (!next) return { tiles: out, stop: foundWall ? 'wall' : 'gap' };
      if (!traverse(next)) return { tiles: out, stop: 'blocked' };
      out.push(next);
      current = next;
    }
  }

  setTile(tx: number, ty: number, id: string): void {
    if (tx < 0 || ty < 0 || tx >= this.cols || ty >= this.rows) return;
    this.grid[ty][tx] = id;
  }

  /** Is the world-space point inside a water tile? */
  waterAt(x: number, y: number): boolean {
    const ts = this.tileSize;
    return tiles.get(this.tileAt(Math.floor(x / ts), Math.floor(y / ts))).water === true;
  }

  /**
   * How submerged a rect is: the fraction (0..1) of its area covered by
   * water tiles. Drives buoyancy (body rect) and oxygen (head rect).
   */
  submersion(r: Rect): number {
    const ts = this.tileSize;
    const area = r.w * r.h;
    if (area <= 0) return 0;
    const x0 = Math.max(0, Math.floor(r.x / ts));
    const y0 = Math.max(0, Math.floor(r.y / ts));
    const x1 = Math.min(this.cols - 1, Math.floor((r.x + r.w - 0.001) / ts));
    const y1 = Math.min(this.rows - 1, Math.floor((r.y + r.h - 0.001) / ts));
    let wet = 0;
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        if (!tiles.get(this.grid[ty][tx]).water) continue;
        const ix = Math.min(r.x + r.w, (tx + 1) * ts) - Math.max(r.x, tx * ts);
        const iy = Math.min(r.y + r.h, (ty + 1) * ts) - Math.max(r.y, ty * ts);
        if (ix > 0 && iy > 0) wet += ix * iy;
      }
    }
    return Math.min(1, wet / area);
  }

  /** Strongest hazard damage among tiles the rect overlaps (0 = safe). */
  hazardAt(r: Rect): number {
    const ts = this.tileSize;
    const x0 = Math.max(0, Math.floor(r.x / ts));
    const y0 = Math.max(0, Math.floor(r.y / ts));
    const x1 = Math.min(this.cols - 1, Math.floor((r.x + r.w - 0.001) / ts));
    const y1 = Math.min(this.rows - 1, Math.floor((r.y + r.h - 0.001) / ts));
    let worst = 0;
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        worst = Math.max(worst, tiles.get(this.grid[ty][tx]).hazard ?? 0);
      }
    }
    return worst;
  }

  /**
   * Does any tile the rect overlaps carry `trait`?
   *
   * The engine still assigns no meaning to trait ids — this only answers
   * the spatial question ("is there breakable/slick/resonant stone
   * here?") that content would otherwise re-derive by hand from
   * `tilesOverlapping`. Same shape as `submersion`/`hazardAt`: a narrow
   * query on the collision seam, so a controller can ask about the world
   * it is touching without holding the tilemap itself.
   */
  traitAt(r: Rect, trait: string): boolean {
    const ts = this.tileSize;
    const x0 = Math.max(0, Math.floor(r.x / ts));
    const y0 = Math.max(0, Math.floor(r.y / ts));
    const x1 = Math.min(this.cols - 1, Math.floor((r.x + r.w - 0.001) / ts));
    const y1 = Math.min(this.rows - 1, Math.floor((r.y + r.h - 0.001) / ts));
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        if (tiles.get(this.grid[ty][tx]).traits?.includes(trait)) return true;
      }
    }
    return false;
  }

  /**
   * Where a body `w` x `h` dropped down column `x` comes to rest: the y
   * of its TOP when standing, or null if the column has nowhere to stand.
   *
   * This replaces a `groundY` that returned the first solid tile scanning
   * down from y=0 — which in any room with a roof is the CEILING. It was
   * right only because its one caller spawns waves, and the one room with
   * waves happens to be open at the top; measured against the four roofed
   * rooms it was wrong in all four. Standing needs a surface AND the room
   * to stand in, so this checks both rather than trusting the first solid
   * thing it meets.
   */
  restingY(x: number, w: number, h: number, fromY = 0): number | null {
    const ts = this.tileSize;
    const c0 = Math.min(Math.max(Math.floor(x / ts), 0), this.cols - 1);
    const c1 = Math.min(Math.max(Math.floor((x + w - 1) / ts), 0), this.cols - 1);
    const standable = (ty: number): boolean => {
      for (let tx = c0; tx <= c1; tx++) {
        const def = tiles.get(this.grid[ty][tx]);
        if (def.solid || def.oneWay) return true;
      }
      return false;
    };
    for (let ty = Math.max(0, Math.floor(fromY / ts)); ty < this.rows; ty++) {
      if (!standable(ty)) continue;
      const top = ty * ts - h;
      if (top < 0) continue; // a surface too close to the roof to stand under
      let clear = true;
      for (let by = Math.floor(top / ts); by < ty && clear; by++) {
        for (let tx = c0; tx <= c1 && clear; tx++) {
          if (tiles.get(this.grid[by][tx]).solid) clear = false;
        }
      }
      if (clear) return top;
    }
    return null;
  }

  *solidsNear(r: Rect): Iterable<Solid> {
    const ts = this.tileSize;
    const x0 = Math.max(0, Math.floor(r.x / ts) - 1);
    const y0 = Math.max(0, Math.floor(r.y / ts) - 1);
    const x1 = Math.min(this.cols - 1, Math.floor((r.x + r.w) / ts) + 1);
    const y1 = Math.min(this.rows - 1, Math.floor((r.y + r.h) / ts) + 1);
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        const def = tiles.get(this.grid[ty][tx]);
        if (def.solid || def.oneWay) {
          yield { x: tx * ts, y: ty * ts, w: ts, h: ts, oneWay: def.oneWay };
        }
      }
    }
    yield* this.extraSolids;
  }

  /** Render only tiles visible in the camera view. */
  render(g: CanvasRenderingContext2D, camX: number, camY: number, viewW: number, viewH: number): void {
    const ts = this.tileSize;
    const x0 = Math.max(0, Math.floor(camX / ts));
    const y0 = Math.max(0, Math.floor(camY / ts));
    const x1 = Math.min(this.cols - 1, Math.floor((camX + viewW) / ts));
    const y1 = Math.min(this.rows - 1, Math.floor((camY + viewH) / ts));
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        const def = tiles.get(this.grid[ty][tx]);
        def.draw?.(g, tx * ts, ty * ts, ts, tx, ty);
      }
    }
  }
}
