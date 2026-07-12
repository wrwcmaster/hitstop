import {
  type Scene,
  Menu,
  drawPanel,
  drawText,
  itemDef,
  clamp,
} from '@engine/index';
import type { ActionGame, Action } from '../defs';
import type { Player } from '../actors/player';
import type { ItemCtx } from '../content/items';
import { COLORS } from '../content/palette';

/**
 * The system menu: an overlay scene (the frozen world stays visible
 * underneath). Two pages — main (resume/inventory/volume/restart) and
 * inventory (use consumables, equip gear, see stats). Esc closes /
 * backs out.
 */
export class PauseScene implements Scene {
  private page: 'main' | 'inventory' = 'main';
  private mainMenu: Menu<Action>;
  private invMenu: Menu<Action> = new Menu([], MENU_ACTIONS);

  constructor(
    private game: ActionGame,
    private player: Player,
    private hooks: { onRestart(): void },
  ) {
    this.mainMenu = new Menu<Action>(
      [
        { label: 'RESUME', onSelect: () => this.close() },
        { label: 'INVENTORY', onSelect: () => this.openInventory() },
        {
          label: () => `VOLUME: ${Math.round(this.game.sfx.volume * 100)}%`,
          onAdjust: (dir) => {
            this.game.sfx.volume = clamp(this.game.sfx.volume + dir * 0.25, 0, 1);
            this.game.sfx.play('menuMove');
          },
          onSelect: () => {
            this.game.sfx.volume = this.game.sfx.volume >= 1 ? 0 : this.game.sfx.volume + 0.25;
            this.game.sfx.play('menuMove');
          },
        },
        {
          label: 'RESTART RUN',
          onSelect: () => {
            this.close();
            this.hooks.onRestart();
          },
        },
      ],
      MENU_ACTIONS,
    );
  }

  enter(): void {
    this.game.sfx.play('menuOpen');
  }

  private close(): void {
    this.game.sfx.play('menuClose');
    this.game.scenes.pop();
  }

  private openInventory(): void {
    this.page = 'inventory';
    this.rebuildInventory();
  }

  private rebuildInventory(): void {
    const p = this.player;
    const entries = p.inventory.slots.map((s) => {
      const def = itemDef<ItemCtx>(s.id);
      return {
        label: `${def.name}${s.count > 1 ? ` X${s.count}` : ''}`,
        hint: () =>
          def.kind === 'equipment'
            ? p.equipment.isEquipped(s.id) ? 'EQUIPPED' : 'EQUIP'
            : def.kind === 'consumable' ? 'USE' : '',
        onSelect: () => {
          if (def.kind === 'equipment') {
            if (!p.equipment.isEquipped(s.id)) {
              p.equipment.equip(s.id);
              p.syncStats();
              this.game.sfx.play('equip');
            }
          } else if (def.kind === 'consumable') {
            if (p.inventory.use(s.id, { game: this.game, player: p })) {
              this.game.sfx.play('menuSelect');
            }
          }
          this.rebuildInventory();
        },
      };
    });
    if (!entries.length) {
      entries.push({ label: 'NOTHING YET', hint: () => '', onSelect: () => {} });
    }
    const keepIndex = Math.min(this.invMenu.index, entries.length - 1);
    this.invMenu = new Menu(entries, MENU_ACTIONS);
    this.invMenu.index = keepIndex;
  }

  update(_dt: number): void {
    const input = this.game.input;
    if (input.consumePress('menu') || input.consumePress('cancel')) {
      if (this.page === 'inventory') {
        this.page = 'main';
        this.game.sfx.play('menuClose');
      } else {
        this.close();
      }
      return;
    }
    (this.page === 'main' ? this.mainMenu : this.invMenu).update(input);
  }

  render(g: CanvasRenderingContext2D): void {
    const W = this.game.width;
    const H = this.game.height;
    g.fillStyle = 'rgba(7,7,13,0.6)';
    g.fillRect(0, 0, W, H);

    if (this.page === 'main') {
      const bw = 150;
      const bh = 90;
      const x = (W - bw) / 2;
      const y = (H - bh) / 2;
      drawPanel(g, x, y, bw, bh);
      drawText(g, 'PAUSED', W / 2, y + 8, COLORS.gold, 2, 'center');
      this.mainMenu.render(g, x + 24, y + 30, { width: bw - 40, lineHeight: 13 });
      drawText(g, 'ESC: CLOSE', W / 2, y + bh - 9, COLORS.steelDark, 1, 'center');
    } else {
      const bw = 240;
      const bh = 150;
      const x = (W - bw) / 2;
      const y = (H - bh) / 2;
      drawPanel(g, x, y, bw, bh);
      drawText(g, 'INVENTORY', W / 2, y + 8, COLORS.gold, 2, 'center');
      this.invMenu.render(g, x + 20, y + 28, { width: bw - 36, lineHeight: 11 });

      // Stat sheet along the bottom: current + equipment-modified values.
      const p = this.player;
      const statY = y + bh - 22;
      g.strokeStyle = COLORS.navyLight;
      g.beginPath();
      g.moveTo(x + 8, statY - 5);
      g.lineTo(x + bw - 8, statY - 5);
      g.stroke();
      drawText(g, `HP ${p.hp}/${p.maxHp}`, x + 12, statY, COLORS.red);
      drawText(g, `MP ${p.mp}/${p.maxMp}`, x + 70, statY, COLORS.blue);
      drawText(g, `ATK +${Math.round(p.stats.get('attack'))}`, x + 124, statY, COLORS.white);
      const weapon = p.equipment.get('weapon');
      drawText(g, weapon ? itemDef(weapon).name : 'BARE HANDS', x + 12, statY + 9, COLORS.steel);
      drawText(g, 'ESC: BACK', x + bw - 12, statY + 9, COLORS.steelDark, 1, 'right');
    }
  }
}

const MENU_ACTIONS = {
  up: 'up' as Action,
  down: 'down' as Action,
  confirm: 'confirm' as Action,
  left: 'left' as Action,
  right: 'right' as Action,
};
