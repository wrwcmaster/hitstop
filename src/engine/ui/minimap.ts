import { Tilemap, tiles } from '../level/tilemap';
import { offscreen } from '../gfx/canvas';

/**
 * Minimap: the tilemap baked once to an offscreen image (1px per tile,
 * scaled to fit a max box), drawn with live markers (player, enemies,
 * pickups, objectives) and an optional viewport rectangle.
 *
 * For fog-of-war later: `reveal(rect)` + explored mask is the natural
 * extension point; bake() is the only place that reads tiles.
 */
export interface MinimapMarker {
  x: number;
  y: number;
  color: string;
  /** Marker size in minimap pixels (default 1). */
  size?: number;
}

export class Minimap {
  private baked: HTMLCanvasElement;
  /** Minimap pixels per world pixel. */
  readonly scale: number;

  constructor(
    private tilemap: Tilemap,
    opts: { maxW?: number; maxH?: number; solidColor?: string; oneWayColor?: string; bg?: string } = {},
  ) {
    const maxW = opts.maxW ?? 60;
    const maxH = opts.maxH ?? 24;
    // Whole tiles per minimap pixel, rounded up so the map always fits.
    const tilesPerPx = Math.max(1, Math.ceil(this.tilemap.cols / maxW), Math.ceil(this.tilemap.rows / maxH));
    this.scale = 1 / (tilesPerPx * tilemap.tileSize);

    const w = Math.ceil(tilemap.cols / tilesPerPx);
    const h = Math.ceil(tilemap.rows / tilesPerPx);
    const [c, g] = offscreen(w, h);
    g.fillStyle = opts.bg ?? 'rgba(7,7,13,0.85)';
    g.fillRect(0, 0, w, h);
    for (let ty = 0; ty < tilemap.rows; ty++) {
      for (let tx = 0; tx < tilemap.cols; tx++) {
        const def = tiles.get(tilemap.tileAt(tx, ty));
        if (def.solid) g.fillStyle = opts.solidColor ?? '#566c86';
        else if (def.oneWay) g.fillStyle = opts.oneWayColor ?? '#33447f';
        else continue;
        g.fillRect(Math.floor(tx / tilesPerPx), Math.floor(ty / tilesPerPx), 1, 1);
      }
    }
    this.baked = c;
  }

  get width(): number {
    return this.baked.width;
  }

  get height(): number {
    return this.baked.height;
  }

  /** Re-bake after tile edits (door opened, wall broken). */
  static rebake(map: Minimap): Minimap {
    return new Minimap(map.tilemap, {});
  }

  render(
    g: CanvasRenderingContext2D,
    x: number,
    y: number,
    markers: MinimapMarker[] = [],
    view?: { x: number; y: number; w: number; h: number },
  ): void {
    g.drawImage(this.baked, x, y);
    g.strokeStyle = '#33447f';
    g.lineWidth = 1;
    g.strokeRect(x - 0.5, y - 0.5, this.width + 1, this.height + 1);

    if (view) {
      g.strokeStyle = 'rgba(148,176,194,0.5)';
      g.strokeRect(
        x + view.x * this.scale,
        y + view.y * this.scale,
        Math.max(2, view.w * this.scale),
        Math.max(2, view.h * this.scale),
      );
    }
    for (const m of markers) {
      const s = m.size ?? 1;
      g.fillStyle = m.color;
      g.fillRect(
        Math.round(x + m.x * this.scale - s / 2),
        Math.round(y + m.y * this.scale - s / 2),
        s,
        s,
      );
    }
  }
}
