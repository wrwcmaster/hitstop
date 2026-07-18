import { Registry } from '../core/registry';
import { Scene } from '../core/scene';
import { Input } from '../input/input';
import { drawText, textWidth } from '../gfx/font';
import { drawPanel } from './widgets';
import { Menu } from './widgets';
import { t } from '../core/i18n';

/**
 * Conversations.
 *
 * A ConversationDef is pure data: a list of spoken lines, optionally
 * ending in choices. The DialogueScene plays one as an overlay (the
 * world freezes underneath, courtesy of the scene stack) with a
 * typewriter reveal; confirm skips, then advances.
 *
 * Branching: a choice can name a `then` conversation, which plays next.
 * Games react to outcomes via the onEnd callback / their event bus.
 */
export interface ConversationLine {
  speaker?: string;
  text: string;
}

export interface ConversationChoice {
  label: string;
  /** Conversation id to chain into when picked. */
  then?: string;
  /** Stable intent id the game reacts to (e.g. 'heal', 'quest:accept').
   * Decouples logic from the display `label`, so prose can change freely. */
  action?: string;
}

export interface ConversationDef {
  lines: ConversationLine[];
  choices?: ConversationChoice[];
}

export const conversations = new Registry<ConversationDef>('conversation');

export function defineConversation(id: string, def: ConversationDef): void {
  conversations.register(id, def);
}

export interface DialogueHost<A extends string> {
  input: Input<A>;
  width: number;
  height: number;
  scenes: { pop(): void; push(s: Scene): void };
}

export interface DialogueOptions<A extends string> {
  confirm: A;
  up: A;
  down: A;
  /** Characters revealed per second (default 45). */
  charsPerSec?: number;
  /** Row height for the choice menu (default 10; raise for touch). */
  choiceLineHeight?: number;
  /** Called when the conversation (including chained ones) finishes. */
  onEnd?(lastChoice?: ConversationChoice): void;
  /** Sound blip per revealed character batch. */
  blip?(): void;
}

/** A char that wraps freely (no spaces in CJK prose): CJK ideographs,
 * kana, fullwidth forms and their punctuation. */
const CJK = /[⺀-鿿　-〿豈-﫿＀-￯]/;

/** Split into wrap units: Latin words stay whole, CJK breaks per glyph. */
function wrapTokens(text: string): string[] {
  const out: string[] = [];
  let word = '';
  for (const ch of text) {
    if (ch === ' ' || CJK.test(ch)) {
      if (word) out.push(word);
      word = '';
      out.push(ch);
    } else {
      word += ch;
    }
  }
  if (word) out.push(word);
  return out;
}

export class DialogueScene<A extends string> implements Scene {
  private lineIdx = 0;
  private revealT = 0;
  private def: ConversationDef;
  private choiceMenu: Menu<A> | null = null;
  private blinkT = 0;

  constructor(
    private host: DialogueHost<A>,
    conversationId: string,
    private opts: DialogueOptions<A>,
  ) {
    this.def = conversations.get(conversationId);
  }

  private get line(): ConversationLine {
    return this.def.lines[this.lineIdx];
  }

  /** The line as displayed: translated to the active locale. */
  private get text(): string {
    return t(this.line.text);
  }

  /** Pixel-measured wrap: Latin breaks at spaces, CJK anywhere. */
  private wrapped(): string[] {
    const maxW = this.host.width - 44;
    const out: string[] = [];
    let cur = '';
    for (const tok of wrapTokens(this.text)) {
      const next = cur + tok;
      if (cur && textWidth(next) > maxW) {
        out.push(cur);
        cur = tok === ' ' ? '' : tok; // never lead a line with the break space
      } else {
        cur = next;
      }
    }
    if (cur) out.push(cur);
    return out.length ? out : [''];
  }

  private get fullyRevealed(): boolean {
    return this.revealT * (this.opts.charsPerSec ?? 45) >= this.text.length;
  }

  private advance(): void {
    if (this.lineIdx < this.def.lines.length - 1) {
      this.lineIdx++;
      this.revealT = 0;
      return;
    }
    // End of lines: choices, or done.
    if (this.def.choices?.length && !this.choiceMenu) {
      this.choiceMenu = new Menu<A>(
        this.def.choices.map((c) => ({
          label: c.label,
          onSelect: () => this.pick(c),
        })),
        { up: this.opts.up, down: this.opts.down, confirm: this.opts.confirm },
      );
      return;
    }
    this.finish(undefined);
  }

  private pick(choice: ConversationChoice): void {
    if (choice.then && conversations.has(choice.then)) {
      // Chain: replace content in-place, keep the scene.
      this.def = conversations.get(choice.then);
      this.lineIdx = 0;
      this.revealT = 0;
      this.choiceMenu = null;
    } else {
      this.finish(choice);
    }
  }

  private finish(choice?: ConversationChoice): void {
    this.host.scenes.pop();
    this.opts.onEnd?.(choice);
  }

  update(dt: number): void {
    this.blinkT += dt;
    if (this.choiceMenu) {
      this.choiceMenu.update(this.host.input);
      const t = this.host.input.consumeTap();
      if (t) this.choiceMenu.tapAt(t.x, t.y);
      return;
    }
    // A tap anywhere acts as confirm: skip the reveal, then advance.
    const tapped = this.host.input.consumeTap() !== null;
    if (!this.fullyRevealed) {
      const before = Math.floor(this.revealT * (this.opts.charsPerSec ?? 45));
      this.revealT += dt;
      const after = Math.floor(this.revealT * (this.opts.charsPerSec ?? 45));
      if (after > before && after % 3 === 0) this.opts.blip?.();
      if (tapped || this.host.input.consumePress(this.opts.confirm)) this.revealT = 999; // skip
      return;
    }
    if (tapped || this.host.input.consumePress(this.opts.confirm)) this.advance();
  }

  render(g: CanvasRenderingContext2D): void {
    const W = this.host.width;
    const H = this.host.height;
    const lines = this.wrapped();
    const clh = this.opts.choiceLineHeight ?? 10;
    const choices = this.choiceMenu ? this.def.choices!.length : 0;
    const boxH = 26 + lines.length * 8 + choices * clh;
    const y = H - boxH - 8;
    drawPanel(g, 12, y, W - 24, boxH);

    let ty = y + 8;
    if (this.line.speaker) {
      drawText(g, t(this.line.speaker), 20, ty, '#ffcd75');
      ty += 9;
    }
    // Typewriter reveal across wrapped lines.
    let budget = Math.floor(this.revealT * (this.opts.charsPerSec ?? 45));
    for (const l of lines) {
      const show = l.slice(0, Math.max(0, budget));
      budget -= l.length;
      drawText(g, show, 20, ty, '#f4f4f4');
      ty += 8;
    }
    if (this.choiceMenu) {
      this.choiceMenu.render(g, 30, ty + 2, { lineHeight: clh, width: W - 84 });
    } else if (this.fullyRevealed && Math.floor(this.blinkT * 2.5) % 2) {
      drawText(g, 'v', W - 26, y + boxH - 9, '#ffcd75');
    }
  }
}
