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
  /** Swimmable liquid: non-solid, but bodies can query how deep they sit
   * in it (see Tilemap.submersion) for buoyancy/oxygen mechanics. */
  water?: boolean;
  /** Contact damage dealt to bodies overlapping this tile (spikes, lava).
   * Non-solid; the game decides who gets hurt and how often. */
  hazard?: number;
  /** Draw one tile at pixel position (px, py). (tx, ty) are tile coords for variation. */
  draw?(g: CanvasRenderingContext2D, px: number, py: number, size: number, tx: number, ty: number): void;
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

  tileAt(tx: number, ty: number): string {
    if (tx < 0 || ty < 0 || tx >= this.cols || ty >= this.rows) return '';
    return this.grid[ty][tx];
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

  /** Top of the first solid tile scanning down column `x` (spawn placement). */
  groundY(x: number): number {
    const ts = this.tileSize;
    const tx = Math.min(Math.max(Math.floor(x / ts), 0), this.cols - 1);
    for (let ty = 0; ty < this.rows; ty++) {
      if (tiles.get(this.grid[ty][tx]).solid) return ty * ts;
    }
    return this.worldH - ts;
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
