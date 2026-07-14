import {
  type Scene,
  Menu,
  drawPanel,
  drawText,
  itemDef,
  clamp,
} from '@engine/index';
import { KEYMAP, GAMEPAD, REBINDABLE, prettyCode, prettyButton, type ActionGame, type Action } from '../defs';
import type { Player } from '../actors/player';
import type { ItemCtx } from '../content/items';
import { COLORS } from '../content/palette';
import { saveSettings } from '../settings';
import { SkillTreeScene } from './skilltree';

/**
 * The system menu: an overlay scene (the frozen world stays visible
 * underneath). Two pages — main (resume/inventory/volume/restart) and
 * inventory (use consumables, equip gear, see stats). Esc closes /
 * backs out.
 */
export class PauseScene implements Scene {
  private page: 'main' | 'inventory' | 'options' | 'controls' = 'main';
  private mainMenu: Menu<Action>;
  private invMenu: Menu<Action> = new Menu([], MENU_ACTIONS);
  private optionsMenu: Menu<Action>;
  private controlsMenu: Menu<Action>;
  /** Label of the action currently waiting for a key press, if any. */
  private rebinding: string | null = null;
  /** Which device the CONTROLS page is rebinding. */
  private device: 'keyboard' | 'gamepad' = 'keyboard';
  /** True while waiting for a gamepad button (vs a key). */
  private padCapturing = false;

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
          label: 'SKILL TREE',
          hint: () => (this.player.progression.skillPoints > 0 ? `${this.player.progression.skillPoints} SP!` : ''),
          onSelect: () => {
            this.game.sfx.play('menuSelect');
            this.game.scenes.push(new SkillTreeScene(this.game, this.player));
          },
        },
        {
          label: 'OPTIONS',
          onSelect: () => {
            this.page = 'options';
            this.game.sfx.play('menuSelect');
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

    const volumeRow = (label: string, channel: 'master' | 'music' | 'sfx') => ({
      label: () => `${label}: ${Math.round(this.game.audio.getVolume(channel) * 100)}%`,
      onAdjust: (dir: -1 | 1) => {
        this.game.audio.setVolume(channel, clamp(this.game.audio.getVolume(channel) + dir * 0.1, 0, 1));
        saveSettings(this.game);
        this.game.sfx.play('menuMove');
      },
      onSelect: () => {
        const v = this.game.audio.getVolume(channel);
        this.game.audio.setVolume(channel, v >= 1 ? 0 : v + 0.25);
        saveSettings(this.game);
        this.game.sfx.play('menuMove');
      },
    });
    this.optionsMenu = new Menu<Action>(
      [
        volumeRow('MASTER', 'master'),
        volumeRow('MUSIC', 'music'),
        volumeRow('SFX', 'sfx'),
        {
          label: () => `FULLSCREEN: ${isFullscreen() ? 'ON' : 'OFF'}`,
          onSelect: () => this.toggleFullscreen(),
          onAdjust: () => this.toggleFullscreen(),
        },
        {
          label: 'CONTROLS',
          onSelect: () => {
            this.page = 'controls';
            this.game.sfx.play('menuSelect');
          },
        },
        {
          label: 'BACK',
          onSelect: () => {
            this.page = 'main';
            this.game.sfx.play('menuClose');
          },
        },
      ],
      MENU_ACTIONS,
    );

    this.controlsMenu = new Menu<Action>(
      [
        {
          // Toggle which device the rows below rebind.
          label: () => `DEVICE: ${this.device === 'keyboard' ? 'KEYBOARD' : 'GAMEPAD'}`,
          onSelect: () => this.toggleDevice(),
          onAdjust: () => this.toggleDevice(),
        },
        ...REBINDABLE.map((r) => ({
          label: r.label,
          hint: () => this.bindingHint(r.action),
          onSelect: () => this.beginRebindActive(r.action, r.label, r.aliases),
        })),
        {
          label: 'RESET DEFAULTS',
          onSelect: () => this.resetActiveDevice(),
        },
        {
          label: 'BACK',
          onSelect: () => {
            this.page = 'options';
            this.game.sfx.play('menuClose');
          },
        },
      ],
      MENU_ACTIONS,
    );
  }

  private toggleDevice(): void {
    this.device = this.device === 'keyboard' ? 'gamepad' : 'keyboard';
    this.game.sfx.play('menuMove');
  }

  /** Flip fullscreen. Triggered from a key/button press, so the browser's
   * user-activation requirement is satisfied. iOS iPhone lacks the API —
   * the toggle just no-ops there. */
  private toggleFullscreen(): void {
    if (isFullscreen()) exitFs();
    else requestFs();
    this.game.sfx.play('menuMove');
  }

  /** Current binding(s) for an action on the active device, for the hint. */
  private bindingHint(action: Action): string {
    if (this.device === 'keyboard') {
      return this.game.input.codesFor(action).map(prettyCode).slice(0, 2).join(' / ') || '---';
    }
    const pad = this.game.pad;
    if (!pad) return 'NO PAD';
    return pad.buttonsFor(action).map(prettyButton).slice(0, 2).join(' / ') || '---';
  }

  private beginRebindActive(action: Action, label: string, aliases: Action[]): void {
    if (this.device === 'keyboard') this.beginRebind(action, label, aliases);
    else this.beginPadRebind(action, label, aliases);
  }

  private resetActiveDevice(): void {
    if (this.device === 'keyboard') {
      this.game.input.setKeymap(KEYMAP);
    } else {
      this.game.pad?.setButtonMap(GAMEPAD.buttons);
    }
    saveSettings(this.game);
    this.game.sfx.play('unlock');
  }

  /** Arm the next-key capture; Esc cancels rather than binding. */
  private beginRebind(action: Action, label: string, aliases: Action[]): void {
    this.rebinding = label;
    this.padCapturing = false;
    this.game.sfx.play('menuSelect');
    this.game.input.captureNextKey((code) => {
      this.rebinding = null;
      if (code === 'Escape') {
        this.game.sfx.play('menuClose');
        return;
      }
      this.game.input.rebind(action, code, aliases);
      saveSettings(this.game);
      this.game.sfx.play('unlock');
    });
  }

  /** Arm the next gamepad-button capture; Esc cancels. */
  private beginPadRebind(action: Action, label: string, aliases: Action[]): void {
    const pad = this.game.pad;
    if (!pad) {
      this.game.sfx.play('denied');
      return;
    }
    this.rebinding = label;
    this.padCapturing = true;
    this.game.sfx.play('menuSelect');
    pad.captureNextButton((index) => {
      this.rebinding = null;
      this.padCapturing = false;
      pad.rebindButton(action, index, aliases);
      saveSettings(this.game);
      this.game.sfx.play('unlock');
    });
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
        label: `${def.name}${s.count > 1 ? ` x${s.count}` : ''}`,
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
      entries.push({ label: 'Nothing yet', hint: () => '', onSelect: () => {} });
    }
    const keepIndex = Math.min(this.invMenu.index, entries.length - 1);
    this.invMenu = new Menu(entries, MENU_ACTIONS);
    this.invMenu.index = keepIndex;
  }

  update(_dt: number): void {
    const input = this.game.input;
    if (this.rebinding) {
      // A key rebind cancels itself through captureNextKey; a pad rebind
      // has no keydown to intercept, so let Esc back out of it here.
      if (this.padCapturing && input.consumePress('menu')) {
        this.game.pad?.cancelCapture();
        this.rebinding = null;
        this.padCapturing = false;
        this.game.sfx.play('menuClose');
      }
      return;
    }
    if (input.consumePress('menu') || input.consumePress('cancel')) {
      if (this.page === 'controls') {
        this.page = 'options';
        this.game.sfx.play('menuClose');
      } else if (this.page !== 'main') {
        this.page = 'main';
        this.game.sfx.play('menuClose');
      } else {
        this.close();
      }
      return;
    }
    const menu =
      this.page === 'main' ? this.mainMenu
      : this.page === 'inventory' ? this.invMenu
      : this.page === 'options' ? this.optionsMenu
      : this.controlsMenu;
    menu.update(input);
    const t = input.consumeTap();
    // Rebinding needs a real key/pad button, so leave the controls rows
    // to those devices; every other page is tap-to-select.
    if (t && this.page !== 'controls') menu.tapAt(t.x, t.y);
  }

  render(g: CanvasRenderingContext2D): void {
    const W = this.game.width;
    const H = this.game.height;
    g.fillStyle = 'rgba(7,7,13,0.6)';
    g.fillRect(0, 0, W, H);

    if (this.page === 'main') {
      const bw = 150;
      const bh = 100;
      const x = (W - bw) / 2;
      const y = (H - bh) / 2;
      drawPanel(g, x, y, bw, bh);
      drawText(g, 'PAUSED', W / 2, y + 8, COLORS.gold, 2, 'center');
      this.mainMenu.render(g, x + 24, y + 30, { width: bw - 40, lineHeight: 13 });
      drawText(g, 'Esc: close', W / 2, y + bh - 9, COLORS.steelDark, 1, 'center');
    } else if (this.page === 'options') {
      const bw = 170;
      const bh = 126;
      const x = (W - bw) / 2;
      const y = (H - bh) / 2;
      drawPanel(g, x, y, bw, bh);
      drawText(g, 'OPTIONS', W / 2, y + 8, COLORS.gold, 2, 'center');
      this.optionsMenu.render(g, x + 24, y + 30, { width: bw - 40, lineHeight: 13 });
      drawText(g, 'Left/Right: adjust', W / 2, y + bh - 9, COLORS.steelDark, 1, 'center');
    } else if (this.page === 'controls') {
      const bw = 210;
      const bh = 170;
      const x = (W - bw) / 2;
      const y = (H - bh) / 2;
      drawPanel(g, x, y, bw, bh);
      drawText(g, 'CONTROLS', W / 2, y + 8, COLORS.gold, 2, 'center');
      this.controlsMenu.render(g, x + 20, y + 26, { width: bw - 36, lineHeight: 11 });
      if (this.rebinding) {
        const what = this.padCapturing ? 'button' : 'key';
        drawText(g, `Press a ${what} for ${this.rebinding}`, W / 2, y + bh - 20, COLORS.gold, 1, 'center');
        drawText(g, 'Esc to cancel', W / 2, y + bh - 11, COLORS.steelDark, 1, 'center');
      } else if (this.device === 'gamepad' && !this.game.pad?.connected) {
        drawText(g, 'Connect a pad, then Z to bind a button', W / 2, y + bh - 11, COLORS.steelDark, 1, 'center');
      } else {
        drawText(g, 'Left/Right: switch device - Z: rebind', W / 2, y + bh - 11, COLORS.steelDark, 1, 'center');
      }
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
      drawText(g, weapon ? itemDef(weapon).name : 'Bare hands', x + 12, statY + 9, COLORS.steel);
      drawText(g, 'Esc: back', x + bw - 12, statY + 9, COLORS.steelDark, 1, 'right');
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

/* ---- Fullscreen API, with the old WebKit spelling for Safari ---- */

interface FsDocument extends Document {
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => void;
}
interface FsElement extends HTMLElement {
  webkitRequestFullscreen?: () => void;
}

function isFullscreen(): boolean {
  const d = document as FsDocument;
  return !!(d.fullscreenElement || d.webkitFullscreenElement);
}

function requestFs(): void {
  const el = document.documentElement as FsElement;
  (el.requestFullscreen?.() as Promise<void> | undefined)?.catch(() => {});
  if (!el.requestFullscreen) el.webkitRequestFullscreen?.();
}

function exitFs(): void {
  const d = document as FsDocument;
  (d.exitFullscreen?.() as Promise<void> | undefined)?.catch(() => {});
  if (!d.exitFullscreen) d.webkitExitFullscreen?.();
}
