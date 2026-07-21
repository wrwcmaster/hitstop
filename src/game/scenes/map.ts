import { type Scene, drawPanel, drawText, drawWorldMap, t } from '@engine/index';
import type { ActionGame } from '../defs';
import { COLORS } from '../content/palette';
import { WORLD_MAP_CELLS, WORLD_MAP_LINKS, roomLabel } from '../content/worldmap';

/**
 * The world map: an overlay scene, so the run freezes behind it and
 * nothing has to be torn down to show it. Rooms you have entered are
 * drawn and joined by their doors; the one you are standing in pulses.
 * Everywhere you have not been is simply absent — the blank space is the
 * information.
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

    // The current room blinks so it reads apart from plain "explored"
    // even at one cell wide.
    const blink = Math.floor(this.uiT * 3) % 2 === 0;
    drawWorldMap(g, WORLD_MAP_CELLS, {
      box: { x: x + 12, y: y + 26, w: bw - 24, h: bh - 56 },
      explored: (id) => id === this.view.current || this.view.explored(id),
      current: blink ? this.view.current : null,
      links: WORLD_MAP_LINKS,
      style: {
        explored: COLORS.navyLight,
        current: COLORS.gold,
        border: COLORS.steel,
        link: COLORS.steelDark,
      },
    });

    const seen = WORLD_MAP_CELLS.filter((c) => c.id === this.view.current || this.view.explored(c.id)).length;
    drawText(g, t(roomLabel(this.view.current)), W / 2, y + bh - 26, COLORS.white, 1, 'center');
    drawText(
      g,
      `${seen}/${WORLD_MAP_CELLS.length} ${t('EXPLORED')}`,
      W / 2, y + bh - 17, COLORS.steel, 1, 'center',
    );
    drawText(g, t('M / Esc: close'), W / 2, y + bh - 9, COLORS.steelDark, 1, 'center');
  }
}
