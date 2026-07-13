import {
  type Scene,
  Menu,
  drawPanel,
  drawText,
  itemDef,
} from '@engine/index';
import { shops } from '../content/shops';
import { ICON_COIN, blit } from '../content/sprites';
import { COLORS } from '../content/palette';
import type { ActionGame, Action } from '../defs';
import type { Player } from '../actors/player';
import type { ItemCtx } from '../content/items';

/**
 * The shop: an overlay scene listing a ShopDef's wares. Buying moves
 * gold to goods; owned equipment shows as OWNED and can't be re-bought.
 * Esc / cancel closes.
 */
export class ShopScene implements Scene {
  private menu!: Menu<Action>;
  private message = '';
  private messageT = 0;

  constructor(
    private game: ActionGame,
    private player: Player,
    private shopId: string,
  ) {
    this.rebuild();
  }

  enter(): void {
    this.game.sfx.play('menuOpen');
  }

  private owned(item: string): boolean {
    const def = itemDef(item);
    return def.kind === 'equipment' &&
      (this.player.inventory.has(item) || this.player.equipment.isEquipped(item));
  }

  private rebuild(): void {
    const def = shops.get(this.shopId);
    const keepIndex = this.menu?.index ?? 0;
    this.menu = new Menu<Action>(
      def.wares.map((w) => ({
        label: itemDef(w.item).name,
        hint: () => (this.owned(w.item) ? 'OWNED' : `${w.price}G`),
        disabled: () => this.owned(w.item),
        onSelect: () => this.buy(w.item, w.price),
      })),
      { up: 'up', down: 'down', confirm: 'confirm' },
    );
    this.menu.index = Math.min(keepIndex, def.wares.length - 1);
  }

  private buy(item: string, price: number): void {
    const p = this.player;
    if (p.gold < price) {
      this.game.sfx.play('denied');
      this.say('Not enough gold');
      return;
    }
    p.gold -= price;
    p.inventory.add(item);
    const def = itemDef<ItemCtx>(item);
    def.onPickup?.({ game: this.game, player: p });
    this.game.sfx.play('buy');
    this.say(`${def.name} - a pleasure`);
    this.game.events.emit('purchase', { id: item, price });
    this.rebuild();
  }

  private say(msg: string): void {
    this.message = msg;
    this.messageT = 2;
  }

  update(dt: number): void {
    this.messageT = Math.max(0, this.messageT - dt);
    const input = this.game.input;
    if (input.consumePress('menu') || input.consumePress('cancel') || input.consumePress('interact')) {
      this.game.sfx.play('menuClose');
      this.game.scenes.pop();
      return;
    }
    this.menu.update(input);
  }

  render(g: CanvasRenderingContext2D): void {
    const gm = this.game;
    const def = shops.get(this.shopId);
    const bw = 250;
    const bh = 140;
    const x = (gm.width - bw) / 2;
    const y = (gm.height - bh) / 2;
    g.fillStyle = 'rgba(7,7,13,0.6)';
    g.fillRect(0, 0, gm.width, gm.height);
    drawPanel(g, x, y, bw, bh);
    drawText(g, def.name, gm.width / 2, y + 8, COLORS.gold, 2, 'center');

    // Purse.
    blit(g, ICON_COIN, x + bw - 58, y + 8);
    drawText(g, String(this.player.gold), x + bw - 50, y + 9, COLORS.gold);

    this.menu.render(g, x + 24, y + 30, { width: bw - 44, lineHeight: 12 });

    // Selected ware's description, then flash messages over it.
    const sel = def.wares[this.menu.index];
    const descY = y + bh - 24;
    g.strokeStyle = COLORS.navyLight;
    g.beginPath();
    g.moveTo(x + 8, descY - 5);
    g.lineTo(x + bw - 8, descY - 5);
    g.stroke();
    if (this.messageT > 0) {
      drawText(g, this.message, gm.width / 2, descY, COLORS.gold, 1, 'center');
    } else if (sel) {
      drawText(g, itemDef(sel.item).desc, gm.width / 2, descY, COLORS.steel, 1, 'center');
    }
    drawText(g, 'Esc: leave', gm.width / 2, y + bh - 11, COLORS.steelDark, 1, 'center');
  }
}
