import { drawText, textWidth } from '../gfx/font';
import { Input } from '../input/input';
import { t } from '../core/i18n';

/**
 * Tiny retained widgets for pixel-font UI: a panel background and a
 * navigable vertical menu. Deliberately minimal — game UIs are 90% "a
 * box with selectable lines of text", and these two cover that while
 * staying trivial to restyle.
 */

export interface PanelStyle {
  bg: string;
  border: string;
  pad: number;
}

export const DEFAULT_PANEL: PanelStyle = {
  bg: 'rgba(7,7,13,0.92)',
  border: '#33447f',
  pad: 8,
};

export function drawPanel(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  style: PanelStyle = DEFAULT_PANEL,
): void {
  g.fillStyle = style.bg;
  g.fillRect(x, y, w, h);
  g.strokeStyle = style.border;
  g.lineWidth = 1;
  g.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  // Pixel corner accents.
  g.fillStyle = style.border;
  for (const [cx, cy] of [[x, y], [x + w - 2, y], [x, y + h - 2], [x + w - 2, y + h - 2]]) {
    g.fillRect(cx, cy, 2, 2);
  }
}

export interface BarStyle {
  /** Track (unfilled) color. */
  bg?: string;
  /** Fill color — or a function of the 0..1 fraction, for thresholds
   * (a boss bar going red under half, a poison-tinted health bar...). */
  fill: string | ((frac: number) => string);
  /** 1px outline drawn just outside the track. */
  border?: string;
}

/**
 * A value bar: track, proportional fill, optional outline. The standard
 * readout for a resource too large to count in icons — health, mana,
 * a boss's life. Because the fill is a fraction of a pixel width rather
 * than a whole icon, ANY damage value reads distinctly: a 5-point graze
 * and a 35-point slam visibly take different bites.
 *
 * `frac` is clamped to 0..1, and a non-zero fill always paints at least
 * one pixel — "nearly dead" should never look identical to "dead".
 */
export function drawBar(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  frac: number,
  style: BarStyle,
): void {
  const f = Math.max(0, Math.min(1, frac));
  if (style.border) {
    g.strokeStyle = style.border;
    g.lineWidth = 1;
    g.strokeRect(x - 0.5, y - 0.5, w + 1, h + 1);
  }
  g.fillStyle = style.bg ?? '#07070d';
  g.fillRect(x, y, w, h);
  if (f <= 0) return;
  g.fillStyle = typeof style.fill === 'function' ? style.fill(f) : style.fill;
  g.fillRect(x, y, Math.max(1, Math.round(w * f)), h);
}

export interface MenuEntry {
  /** Label, or a getter for live values ("VOLUME: 75%"). */
  label: string | (() => string);
  /** Dimmed and unselectable. */
  disabled?: boolean | (() => boolean);
  /** Right-aligned secondary text (counts, equipped markers). */
  hint?: string | (() => string);
  onSelect?(): void;
  /** Left/right pressed while selected (sliders, cyclers). */
  onAdjust?(dir: -1 | 1): void;
}

export interface MenuActions<A extends string> {
  up: A;
  down: A;
  confirm: A;
  left?: A;
  right?: A;
}

/**
 * A vertical menu. Call `update` with the game input each step while
 * active, `render` wherever it should appear.
 */
export class Menu<A extends string = string> {
  index = 0;
  /** Geometry of the last render(), for pointer/touch hit-testing. */
  private layout: { x: number; y: number; lh: number; s: number; width?: number } | null = null;

  constructor(
    public entries: MenuEntry[],
    private actions: MenuActions<A>,
  ) {}

  private isDisabled(e: MenuEntry): boolean {
    return typeof e.disabled === 'function' ? e.disabled() : !!e.disabled;
  }

  private move(dir: number): void {
    if (!this.entries.length) return;
    for (let i = 0; i < this.entries.length; i++) {
      this.index = (this.index + dir + this.entries.length) % this.entries.length;
      if (!this.isDisabled(this.entries[this.index])) return;
    }
  }

  get selected(): MenuEntry | undefined {
    return this.entries[this.index];
  }

  update(input: Input<A>): void {
    if (input.consumePress(this.actions.up)) this.move(-1);
    if (input.consumePress(this.actions.down)) this.move(1);
    const sel = this.selected;
    if (!sel || this.isDisabled(sel)) return;
    if (input.consumePress(this.actions.confirm)) sel.onSelect?.();
    if (this.actions.left && input.consumePress(this.actions.left)) sel.onAdjust?.(-1);
    if (this.actions.right && input.consumePress(this.actions.right)) sel.onAdjust?.(1);
  }

  /**
   * Activate the entry under a logical-space point (touch/click). Returns
   * true if a live entry was hit — selecting it and firing its onSelect,
   * so a tap picks a menu item directly with no on-screen arrows.
   * Hit zones are generous: rows tile contiguously and extend well past
   * the text, so an imprecise thumb still lands.
   */
  tapAt(px: number, py: number): boolean {
    const L = this.layout;
    if (!L) return false;
    for (let i = 0; i < this.entries.length; i++) {
      const e = this.entries[i];
      if (this.isDisabled(e)) continue;
      const rowY = L.y + i * L.lh;
      const label = t(typeof e.label === 'function' ? e.label() : e.label);
      const right = L.x + Math.max(L.width ?? 0, textWidth(label, L.s)) + 24;
      if (px >= L.x - 24 && px <= right && py >= rowY - 2 && py <= rowY + L.lh - 2) {
        this.index = i;
        e.onSelect?.();
        return true;
      }
    }
    return false;
  }

  render(
    g: CanvasRenderingContext2D,
    x: number,
    y: number,
    opts: { width?: number; lineHeight?: number; scale?: number } = {},
  ): void {
    const lh = opts.lineHeight ?? 12;
    const s = opts.scale ?? 1;
    this.layout = { x, y, lh, s, width: opts.width };
    this.entries.forEach((e, i) => {
      // Labels translate at render time, so a locale switch repaints
      // every open menu live (dynamic labels just miss the table).
      const label = t(typeof e.label === 'function' ? e.label() : e.label);
      const hint = t(typeof e.hint === 'function' ? (e.hint() ?? '') : (e.hint ?? ''));
      const sel = i === this.index;
      const color = this.isDisabled(e) ? '#566c86' : sel ? '#ffcd75' : '#f4f4f4';
      if (sel) drawText(g, '>', x - 8, y + i * lh, '#ffcd75', s);
      drawText(g, label, x, y + i * lh, color, s);
      if (hint && opts.width) {
        drawText(g, hint, x + opts.width - textWidth(hint, s), y + i * lh, '#94b0c2', s);
      }
    });
  }
}
