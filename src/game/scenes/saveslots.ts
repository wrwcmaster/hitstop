import { type Scene, Menu, drawPanel, drawText } from '@engine/index';
import { COLORS } from '../content/palette';
import { menuLine, type ActionGame, type Action } from '../defs';
import { SAVE_SLOT_COUNT, slotStore, slotSummary } from '../save';

/**
 * The save/load slots overlay. 'save' writes the current run into a
 * manual slot; 'load' starts a run from any non-empty slot (including
 * the autosave). Rows re-label live, so a save shows immediately.
 */
export class SaveSlotsScene implements Scene {
  private menu: Menu<Action>;

  constructor(
    private game: ActionGame,
    private mode: 'save' | 'load',
    private hooks: {
      /** Persist the current run into a manual slot (1-based). */
      saveTo?(slot: number): void;
      /** Start/resume a run from a slot (0 = autosave). */
      loadFrom?(slot: number): void;
    },
  ) {
    const entries = [];
    // Loading offers the autosave too; saving only the manual slots.
    const first = mode === 'load' ? 0 : 1;
    for (let s = first; s <= SAVE_SLOT_COUNT; s++) {
      const slot = s;
      entries.push({
        label: () => slotSummary(slot),
        onSelect: () => this.pick(slot),
      });
    }
    entries.push({ label: 'BACK', onSelect: () => this.close() });
    this.menu = new Menu<Action>(entries, {
      up: 'up' as Action, down: 'down' as Action, confirm: 'confirm' as Action,
    });
  }

  enter(): void {
    this.game.sfx.play('menuOpen');
  }

  private pick(slot: number): void {
    if (this.mode === 'save') {
      this.hooks.saveTo?.(slot);
      this.game.sfx.play('unlock');
      return; // stay open: the row now shows the new summary
    }
    if (!slotStore(slot).exists()) {
      this.game.sfx.play('denied');
      return;
    }
    this.close();
    this.hooks.loadFrom?.(slot);
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
    const lh = menuLine(13);
    const bw = 220;
    const bh = 44 + this.menu.entries.length * lh;
    const x = (W - bw) / 2;
    const y = (H - bh) / 2;
    drawPanel(g, x, y, bw, bh);
    drawText(g, this.mode === 'save' ? 'SAVE GAME' : 'LOAD GAME', W / 2, y + 8, COLORS.gold, 2, 'center');
    this.menu.render(g, x + 22, y + 30, { width: bw - 40, lineHeight: lh });
    drawText(
      g,
      this.mode === 'save' ? 'Pick a slot to save into' : 'Pick a save to resume',
      W / 2, y + bh - 9, COLORS.steelDark, 1, 'center',
    );
  }
}
