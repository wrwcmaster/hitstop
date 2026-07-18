import { type Scene, Menu, drawPanel, drawText } from '@engine/index';
import { COLORS } from '../content/palette';
import { menuLine, type ActionGame, type Action } from '../defs';
import { portalDests, type PortalDest } from '../content/portals';

/**
 * The portal menu: step onto a portal pad and pick a destination. Only
 * places you've *visited* appear (plus never the one you're standing in),
 * so the network reveals itself as you explore and always offers a way
 * back to town.
 */
export class PortalScene implements Scene {
  private menu: Menu<Action>;
  private dests: PortalDest[];

  constructor(
    private game: ActionGame,
    currentRoom: string,
    hasVisited: (room: string) => boolean,
    private onWarp: (dest: PortalDest) => void,
  ) {
    this.dests = portalDests().filter((d) => d.room !== currentRoom && hasVisited(d.room));
    const entries = this.dests.map((d) => ({
      label: d.label,
      onSelect: () => this.pick(d),
    }));
    if (!entries.length) {
      entries.push({ label: 'Nowhere else yet', onSelect: () => this.close() } as (typeof entries)[number]);
    }
    entries.push({ label: 'CANCEL', onSelect: () => this.close() } as (typeof entries)[number]);
    this.menu = new Menu<Action>(entries, {
      up: 'up' as Action, down: 'down' as Action, confirm: 'confirm' as Action,
    });
  }

  enter(): void {
    this.game.sfx.play('menuOpen');
  }

  private pick(dest: PortalDest): void {
    this.close();
    this.onWarp(dest);
  }

  private close(): void {
    this.game.sfx.play('menuClose');
    this.game.scenes.pop();
  }

  update(_dt: number): void {
    const input = this.game.input;
    if (input.consumePress('menu') || input.consumePress('cancel')) {
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
    g.fillStyle = 'rgba(7,7,13,0.6)';
    g.fillRect(0, 0, W, H);
    const lh = menuLine(12);
    const bw = 260;
    const bh = 44 + this.menu.entries.length * lh;
    const x = (W - bw) / 2;
    const y = (H - bh) / 2;
    drawPanel(g, x, y, bw, bh);
    drawText(g, 'PORTAL', W / 2, y + 8, COLORS.blue, 2, 'center');
    this.menu.render(g, x + 22, y + 30, { width: bw - 40, lineHeight: lh });
    drawText(g, 'Step through to a distant gate', W / 2, y + bh - 9, COLORS.steelDark, 1, 'center');
  }
}
