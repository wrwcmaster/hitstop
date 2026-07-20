import {
  type Scene,
  Menu,
  drawPanel,
  drawText,
  itemDef,
  formatAmount,
  t,
} from '@engine/index';
import { menuLine, type ActionGame, type Action } from '../defs';
import type { Player } from '../actors/player';
import type { ItemCtx } from '../content/items';
import { COLORS } from '../content/palette';
import { SkillTreeScene } from './skilltree';
import { OptionsScene } from './options';
import { SaveSlotsScene } from './saveslots';

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
  /** "SAVED!" flash on the SAVE REPLAY row, in seconds remaining. */
  private replaySavedT = 0;

  constructor(
    private game: ActionGame,
    private player: Player,
    private hooks: {
      onRestart(): void;
      /** Persist the current run into a manual slot (1-based). */
      onSaveSlot?(slot: number): void;
      /** Resume a run from a slot (0 = autosave). */
      onLoadSlot?(slot: number): void;
    },
  ) {
    this.mainMenu = new Menu<Action>(
      [
        { label: 'RESUME', onSelect: () => this.close() },
        { label: 'INVENTORY', onSelect: () => this.openInventory() },
        {
          label: 'SKILL TREE',
          hint: () => (this.player.progression.skillPoints > 0 ? `${this.player.progression.skillPoints} SP!` : ''),
          onSelect: () => {
            this.game.sfx.play('menuSelect');
            this.game.scenes.push(new SkillTreeScene(this.game, this.player));
          },
        },
        {
          label: 'SAVE GAME',
          onSelect: () => {
            this.game.sfx.play('menuSelect');
            this.game.scenes.push(new SaveSlotsScene(this.game, 'save', {
              saveTo: (slot) => this.hooks.onSaveSlot?.(slot),
            }));
          },
        },
        {
          label: 'LOAD GAME',
          onSelect: () => {
            this.game.sfx.play('menuSelect');
            this.game.scenes.push(new SaveSlotsScene(this.game, 'load', {
              loadFrom: (slot) => {
                this.close();
                this.hooks.onLoadSlot?.(slot);
              },
            }));
          },
        },
        {
          // Download this run's input tape (see src/game/test/harness.ts) —
          // a bug report that reproduces itself via `npm run replay`.
          label: 'SAVE REPLAY',
          hint: () => (this.replaySavedT > 0 ? t('SAVED!') : ''),
          onSelect: () => {
            if (!window.__replay) return;
            window.__replay.save();
            this.replaySavedT = 3;
            this.game.sfx.play('menuSelect');
          },
        },
        {
          label: 'OPTIONS',
          onSelect: () => {
            this.game.sfx.play('menuSelect');
            this.game.scenes.push(new OptionsScene(this.game));
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
        label: `${t(def.name)}${s.count > 1 ? ` x${s.count}` : ''}`,
        hint: () =>
          def.kind === 'equipment'
            ? p.equipment.isEquipped(s.id) ? 'EQUIPPED' : 'EQUIP'
            : def.kind === 'consumable' ? 'USE' : '',
        onSelect: () => {
          if (def.kind === 'equipment') {
            if (p.equipment.isEquipped(s.id)) {
              p.equipment.unequip(def.slot!);
              p.syncStats();
              this.game.sfx.play('menuClose');
            } else {
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
      entries.push({ label: 'Nothing yet', hint: () => '', onSelect: () => {} });
    }
    const keepIndex = Math.min(this.invMenu.index, entries.length - 1);
    this.invMenu = new Menu(entries, MENU_ACTIONS);
    this.invMenu.index = keepIndex;
  }

  update(dt: number): void {
    if (this.replaySavedT > 0) this.replaySavedT -= dt;
    const input = this.game.input;
    if (input.consumePress('menu') || input.consumePress('cancel')) {
      if (this.page !== 'main') {
        this.page = 'main';
        this.game.sfx.play('menuClose');
      } else {
        this.close();
      }
      return;
    }
    const menu = this.page === 'main' ? this.mainMenu : this.invMenu;
    menu.update(input);
    const t = input.consumeTap();
    if (t) menu.tapAt(t.x, t.y);
  }

  render(g: CanvasRenderingContext2D): void {
    const W = this.game.width;
    const H = this.game.height;
    g.fillStyle = 'rgba(7,7,13,0.6)';
    g.fillRect(0, 0, W, H);

    if (this.page === 'main') {
      const lh = menuLine(13);
      const bw = 150;
      const bh = 44 + this.mainMenu.entries.length * lh;
      const x = (W - bw) / 2;
      const y = (H - bh) / 2;
      drawPanel(g, x, y, bw, bh);
      drawText(g, t('PAUSED'), W / 2, y + 8, COLORS.gold, 2, 'center');
      this.mainMenu.render(g, x + 24, y + 30, { width: bw - 40, lineHeight: lh });
      drawText(g, t('Esc: close'), W / 2, y + bh - 9, COLORS.steelDark, 1, 'center');
    } else {
      const lh = menuLine(11);
      const bw = 240;
      const bh = Math.min(H - 16, 62 + this.invMenu.entries.length * lh);
      const x = (W - bw) / 2;
      const y = (H - bh) / 2;
      drawPanel(g, x, y, bw, bh);
      drawText(g, t('INVENTORY'), W / 2, y + 8, COLORS.gold, 2, 'center');
      this.invMenu.render(g, x + 20, y + 28, { width: bw - 36, lineHeight: lh });

      // Stat sheet along the bottom: current + equipment-modified values.
      const p = this.player;
      const statY = y + bh - 22;
      g.strokeStyle = COLORS.navyLight;
      g.beginPath();
      g.moveTo(x + 8, statY - 5);
      g.lineTo(x + bw - 8, statY - 5);
      g.stroke();
      drawText(g, `HP ${formatAmount(p.hp)}/${p.maxHp}`, x + 12, statY, COLORS.red);
      drawText(g, `MP ${formatAmount(p.mp)}/${p.maxMp}`, x + 70, statY, COLORS.blue);
      drawText(g, `ATK +${Math.round(p.stats.get('attack'))}`, x + 124, statY, COLORS.white);
      const weapon = p.equipment.get('weapon');
      drawText(g, weapon ? t(itemDef(weapon).name) : t('Bare hands'), x + 12, statY + 9, COLORS.steel);
      drawText(g, t('Esc: back'), x + bw - 12, statY + 9, COLORS.steelDark, 1, 'right');
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
