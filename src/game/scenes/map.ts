import { type Scene, drawPanel, drawText, drawWorldMap, t } from '@engine/index';
import type { ActionGame } from '../defs';
import { COLORS } from '../content/palette';
import { WORLD_MAP_CELLS, WORLD_MAP_DOORS, WORLD_MAP_LINKS, roomLabel } from '../content/worldmap';

/**
 * The world map: an overlay scene, so the run freezes behind it and
 * nothing has to be torn down to show it. Rooms you have entered are
 * drawn as blocks, and a pip on a shared edge marks each door between
 * two explored rooms; the one you are standing in pulses. Everywhere you
 * have not been is simply absent — the blank space is the information.
 */
export class MapScene implements Scene {
  /** Free-running clock for the you-are-here pulse. */
  private uiT = 0;

  constructor(
    private game: ActionGame,
    private view: {
      /** Room the player currently occupies. */
      current: string;
      /** Has the player entered this room? */
      explored(id: string): boolean;
    },
  ) {}

  enter(): void {
    this.game.sfx.play('menuOpen');
  }

  update(dt: number): void {
    this.uiT += dt;
    const input = this.game.input;
    // The key that opens it also closes it, alongside the usual backs.
    if (input.consumePress('map') || input.consumePress('menu') || input.consumePress('cancel')) {
      this.game.sfx.play('menuClose');
      this.game.scenes.pop();
      return;
    }
    if (input.consumeTap()) {
      this.game.sfx.play('menuClose');
      this.game.scenes.pop();
    }
  }

  render(g: CanvasRenderingContext2D): void {
    const W = this.game.width;
    const H = this.game.height;
    g.fillStyle = 'rgba(7,7,13,0.72)';
    g.fillRect(0, 0, W, H);

    const bw = Math.min(W - 24, 200);
    const bh = Math.min(H - 20, 116);
    const x = Math.round((W - bw) / 2);
    const y = Math.round((H - bh) / 2);
    drawPanel(g, x, y, bw, bh);
    drawText(g, t('MAP'), W / 2, y + 8, COLORS.gold, 2, 'center');

    // The current room is ALWAYS gold. It used to blink at 3Hz by being
    // handed `null` on the off beat — so for half of every second the map
    // showed no you-are-here at all, and opening it on the wrong frame
    // read as simply not marking your room. A pulse should add emphasis,
    // never subtract the answer, so the beat rides the ring around it.
    const pulse = Math.floor(this.uiT * 3) % 2 === 0;
    const cellSize = drawWorldMap(g, WORLD_MAP_CELLS, {
      box: { x: x + 12, y: y + 26, w: bw - 24, h: bh - 56 },
      explored: (id) => id === this.view.current || this.view.explored(id),
      current: this.view.current,
      doors: WORLD_MAP_DOORS,
      // Connections whose rooms do not touch on the grid — a shaft that
      // climbs half the map. Drawn as a wire, since there is no shared
      // edge to sit a doorway pip on.
      links: WORLD_MAP_LINKS,
      style: {
        explored: COLORS.navyLight,
        current: COLORS.gold,
        border: COLORS.steel,
        link: COLORS.steelDark,
        door: COLORS.gold,
      },
    });
    this.pulseCurrent(g, x, y, bw, bh, cellSize, pulse);

    const seen = WORLD_MAP_CELLS.filter((c) => c.id === this.view.current || this.view.explored(c.id)).length;
    drawText(g, t(roomLabel(this.view.current)), W / 2, y + bh - 26, COLORS.white, 1, 'center');
    drawText(
      g,
      `${seen}/${WORLD_MAP_CELLS.length} ${t('EXPLORED')}`,
      W / 2, y + bh - 17, COLORS.steel, 1, 'center',
    );
    drawText(g, t('M / Esc: close'), W / 2, y + bh - 9, COLORS.steelDark, 1, 'center');
  }

  /**
   * A ring around the room you are standing in, on the beat.
   *
   * drawWorldMap returns the cell size it chose and lays cells out from
   * the same fixed frame every time, so the ring can be placed on that
   * grid without the widget needing to know what a "you are here" pulse
   * is. At one cell wide a filled gold block alone is easy to lose among
   * explored neighbours; the ring is what carries the eye.
   */
  private pulseCurrent(
    g: CanvasRenderingContext2D,
    x: number, y: number, bw: number, bh: number,
    size: number, on: boolean,
  ): void {
    if (!on || size <= 0) return;
    const cell = WORLD_MAP_CELLS.find((c) => c.id === this.view.current);
    if (!cell) return;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const c of WORLD_MAP_CELLS) {
      minX = Math.min(minX, c.x);
      minY = Math.min(minY, c.y);
      maxX = Math.max(maxX, c.x + (c.w ?? 1));
      maxY = Math.max(maxY, c.y + (c.h ?? 1));
    }
    const box = { x: x + 12, y: y + 26, w: bw - 24, h: bh - 56 };
    const originX = Math.round(box.x + (box.w - (maxX - minX) * size) / 2);
    const originY = Math.round(box.y + (box.h - (maxY - minY) * size) / 2);
    const rx = originX + (cell.x - minX) * size;
    const ry = originY + (cell.y - minY) * size;
    g.strokeStyle = COLORS.white;
    g.lineWidth = 1;
    g.strokeRect(rx - 0.5, ry - 0.5, (cell.w ?? 1) * size + 1, (cell.h ?? 1) * size + 1);
  }
}
