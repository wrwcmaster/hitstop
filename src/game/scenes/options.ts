import { type Scene, Menu, drawPanel, drawText, clamp, t, locale, setLocale, localeIds, localeName } from '@engine/index';
import { KEYMAP, GAMEPAD, REBINDABLE, prettyCode, prettyButton, menuLine, COARSE_POINTER, type ActionGame, type Action } from '../defs';
import { COLORS } from '../content/palette';
import { saveSettings } from '../settings';

/**
 * Settings overlay: audio volumes, fullscreen, and key/gamepad rebinding.
 * A standalone scene so it opens from both the title screen and the pause
 * menu — nothing here needs a running game or a player.
 */
export class OptionsScene implements Scene {
  private page: 'options' | 'controls' = 'options';
  private optionsMenu: Menu<Action>;
  private controlsMenu: Menu<Action>;
  /** Label of the action currently waiting for a key/button press, if any. */
  private rebinding: string | null = null;
  private device: 'keyboard' | 'gamepad' = 'keyboard';
  private padCapturing = false;

  constructor(private game: ActionGame) {
    // Cycle through registered locales; the whole UI repaints live
    // because menus/dialogue translate at render time.
    const cycleLocale = (dir: 1 | -1) => {
      const ids = localeIds();
      const next = ids[(ids.indexOf(locale()) + dir + ids.length) % ids.length];
      setLocale(next);
      saveSettings(this.game);
      this.game.sfx.play('menuMove');
    };
    const volumeRow = (label: string, channel: 'master' | 'music' | 'sfx') => ({
      label: () => `${t(label)}: ${Math.round(this.game.audio.getVolume(channel) * 100)}%`,
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
          label: () => `${t('FULLSCREEN')}: ${isFullscreen() ? t('ON') : t('OFF')}`,
          onSelect: () => this.toggleFullscreen(),
          onAdjust: () => this.toggleFullscreen(),
        },
        {
          label: () => `${t('LANGUAGE')}: ${localeName(locale())}`,
          onSelect: () => cycleLocale(1),
          onAdjust: (dir: -1 | 1) => cycleLocale(dir),
        },
        {
          label: 'CONTROLS',
          onSelect: () => {
            this.page = 'controls';
            this.game.sfx.play('menuSelect');
          },
        },
        { label: 'BACK', onSelect: () => this.close() },
      ],
      MENU_ACTIONS,
    );

    this.controlsMenu = new Menu<Action>(
      [
        {
          label: () => `DEVICE: ${this.device === 'keyboard' ? 'KEYBOARD' : 'GAMEPAD'}`,
          onSelect: () => this.toggleDevice(),
          onAdjust: () => this.toggleDevice(),
        },
        ...REBINDABLE.map((r) => ({
          label: r.label,
          hint: () => this.bindingHint(r.action),
          onSelect: () => this.beginRebindActive(r.action, r.label, r.aliases),
        })),
        { label: 'RESET DEFAULTS', onSelect: () => this.resetActiveDevice() },
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

  enter(): void {
    this.game.sfx.play('menuOpen');
  }

  private close(): void {
    this.game.sfx.play('menuClose');
    this.game.scenes.pop();
  }

  private toggleDevice(): void {
    this.device = this.device === 'keyboard' ? 'gamepad' : 'keyboard';
    this.game.sfx.play('menuMove');
  }

  /** Flip fullscreen. Triggered from a key/button/tap, so the browser's
   * user-activation requirement is satisfied. iOS iPhone lacks the API —
   * the toggle just no-ops there. */
  private toggleFullscreen(): void {
    if (isFullscreen()) exitFs();
    else requestFs();
    this.game.sfx.play('menuMove');
  }

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
    if (this.device === 'keyboard') this.game.input.setKeymap(KEYMAP);
    else this.game.pad?.setButtonMap(GAMEPAD.buttons);
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

  update(_dt: number): void {
    const input = this.game.input;
    if (this.rebinding) {
      // The 'menu' ACTION cancels either capture — a keydown-only escape
      // would strand touch users, whose ☰ button never emits a keydown.
      if (input.consumePress('menu')) {
        if (this.padCapturing) this.game.pad?.cancelCapture();
        else input.cancelCapture();
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
      } else {
        this.close();
      }
      return;
    }
    const menu = this.page === 'options' ? this.optionsMenu : this.controlsMenu;
    menu.update(input);
    const t = input.consumeTap();
    if (t) menu.tapAt(t.x, t.y);
  }

  render(g: CanvasRenderingContext2D): void {
    const W = this.game.width;
    const H = this.game.height;
    g.fillStyle = 'rgba(7,7,13,0.6)';
    g.fillRect(0, 0, W, H);

    if (this.page === 'options') {
      const lh = menuLine(13);
      const bw = 170;
      const bh = 44 + this.optionsMenu.entries.length * lh;
      const x = (W - bw) / 2;
      const y = (H - bh) / 2;
      drawPanel(g, x, y, bw, bh);
      drawText(g, 'OPTIONS', W / 2, y + 8, COLORS.gold, 2, 'center');
      this.optionsMenu.render(g, x + 24, y + 30, { width: bw - 40, lineHeight: lh });
      drawText(g, 'Left/Right: adjust', W / 2, y + bh - 9, COLORS.steelDark, 1, 'center');
    } else {
      const lh = menuLine(11);
      const bw = 210;
      const bh = Math.min(H - 12, 56 + this.controlsMenu.entries.length * lh);
      const x = (W - bw) / 2;
      const y = (H - bh) / 2;
      drawPanel(g, x, y, bw, bh);
      drawText(g, 'CONTROLS', W / 2, y + 8, COLORS.gold, 2, 'center');
      this.controlsMenu.render(g, x + 20, y + 26, { width: bw - 36, lineHeight: lh });
      if (this.rebinding) {
        const what = this.padCapturing ? 'button' : 'key';
        drawText(g, `Press a ${what} for ${this.rebinding}`, W / 2, y + bh - 20, COLORS.gold, 1, 'center');
        drawText(g, COARSE_POINTER ? 'Menu button to cancel' : 'Esc to cancel', W / 2, y + bh - 11, COLORS.steelDark, 1, 'center');
      } else if (this.device === 'gamepad' && !this.game.pad?.connected) {
        drawText(g, 'Connect a pad, then Z to bind a button', W / 2, y + bh - 11, COLORS.steelDark, 1, 'center');
      } else {
        drawText(g, 'Left/Right: switch device - Z: rebind', W / 2, y + bh - 11, COLORS.steelDark, 1, 'center');
      }
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
