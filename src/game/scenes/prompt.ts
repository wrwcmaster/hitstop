import { type Scene, Menu, drawPanel, drawText, textWidth } from '@engine/index';
import { blit, TEXEL } from '../content/sprites';
import { COLORS } from '../content/palette';
import { menuLine, type ActionGame, type Action } from '../defs';

export interface PromptOption {
  label: string;
  onSelect(): void;
}

/**
 * A small yes/no (or few-option) overlay: a titled panel with a vertical
 * menu. The world beneath freezes while it's up. Generic on purpose —
 * "Equip this?", "Really restart?", any quick decision.
 */
export class PromptScene implements Scene {
  private menu: Menu<Action>;

  constructor(
    private game: ActionGame,
    private title: string,
    options: PromptOption[],
    private icon?: HTMLCanvasElement,
  ) {
    this.menu = new Menu<Action>(
      options.map((o) => ({
        label: o.label,
        onSelect: () => {
          this.close();
          o.onSelect();
        },
      })),
      { up: 'up', down: 'down', confirm: 'confirm' },
    );
  }

  enter(): void {
    this.game.sfx.play('menuOpen');
  }

  private close(): void {
    this.game.scenes.pop();
  }

  update(): void {
    const input = this.game.input;
    if (input.consumePress('menu') || input.consumePress('cancel')) {
      this.game.sfx.play('menuClose');
      this.close();
      return;
    }
    this.menu.update(input);
    const t = input.consumeTap();
    if (t) this.menu.tapAt(t.x, t.y);
  }

  render(g: CanvasRenderingContext2D): void {
    const W = this.game.width;
    const H = this.game.height;
    g.fillStyle = 'rgba(7,7,13,0.55)';
    g.fillRect(0, 0, W, H);

    const lh = menuLine(11);
    const bw = Math.max(120, textWidth(this.title, 1) + 40);
    const bh = 40 + this.menu.entries.length * lh + (this.icon ? this.icon.height / TEXEL + 2 : 0);
    const x = (W - bw) / 2;
    const y = (H - bh) / 2;
    drawPanel(g, x, y, bw, bh);

    let ty = y + 10;
    if (this.icon) {
      blit(g, this.icon, W / 2 - this.icon.width / TEXEL / 2, ty - 2);
      ty += this.icon.height / TEXEL + 2;
    }
    drawText(g, this.title, W / 2, ty, COLORS.gold, 1, 'center');
    this.menu.render(g, x + 26, ty + 14, { width: bw - 44, lineHeight: lh });
  }
}
