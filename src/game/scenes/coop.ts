import { type Scene, PeerLink, drawText } from '@engine/index';
import { COLORS } from '../content/palette';
import type { ActionGame } from '../defs';

/**
 * Co-op lobby: the copy-paste handshake. WebRTC needs an offer/answer
 * exchanged once before the browsers talk directly; with no server, the
 * players relay the two codes themselves (chat, email, QR of choice).
 *
 *   host: HOST GAME → send invite code → paste reply → connected
 *   guest: JOIN GAME → paste invite → send reply code → connected
 *
 * The exchange UI is a DOM overlay (textareas + clipboard buttons) —
 * pasting into a canvas is not a thing. The canvas just dims underneath.
 */
export interface CoopHooks {
  /** Start hosting the run with an open link. */
  hostStart(link: PeerLink): void;
  /** Become the guest renderer for an open link. */
  guestStart(link: PeerLink): void;
}

export class CoopScene implements Scene {
  private root: HTMLDivElement | null = null;
  private link: PeerLink | null = null;
  private status = '';
  private done = false;

  constructor(
    private game: ActionGame,
    private hooks: CoopHooks,
  ) {}

  enter(): void {
    this.game.sfx.play('menuOpen');
    this.buildMenu();
  }

  exit(): void {
    this.root?.remove();
    this.root = null;
    if (!this.done) this.link?.close();
  }

  update(_dt: number): void {
    if (this.game.input.consumePress('menu') || this.game.input.consumePress('cancel')) {
      this.close();
    }
  }

  private close(): void {
    this.game.sfx.play('menuClose');
    this.game.scenes.pop();
  }

  /** Hand the open link to the game and leave the lobby. */
  private connected(role: 'host' | 'guest'): void {
    const link = this.link!;
    this.done = true;
    this.game.sfx.play('levelup');
    this.game.scenes.pop();
    if (role === 'host') this.hooks.hostStart(link);
    else this.hooks.guestStart(link);
  }

  /* ---------------- DOM overlay ---------------- */

  private panel(): HTMLDivElement {
    this.root?.remove();
    const el = document.createElement('div');
    el.style.cssText =
      'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;' +
      'z-index:30;font-family:monospace;color:#eee;pointer-events:none;';
    const box = document.createElement('div');
    box.style.cssText =
      'background:#0d0d16;border:1px solid #3b4a6b;padding:16px 20px;max-width:340px;' +
      'width:90%;pointer-events:auto;box-shadow:0 0 40px #000;';
    el.appendChild(box);
    document.body.appendChild(el);
    this.root = el;
    return box;
  }

  private el<K extends keyof HTMLElementTagNameMap>(
    parent: HTMLElement, tag: K, text: string, css = '',
  ): HTMLElementTagNameMap[K] {
    const e = document.createElement(tag);
    e.textContent = text;
    e.style.cssText = css;
    parent.appendChild(e);
    return e;
  }

  private button(parent: HTMLElement, label: string, onClick: () => void): HTMLButtonElement {
    const b = this.el(parent, 'button', label,
      'display:block;width:100%;margin:6px 0;padding:8px;background:#1d2438;color:#ffd166;' +
      'border:1px solid #3b4a6b;font-family:monospace;font-size:14px;cursor:pointer;');
    b.onclick = onClick;
    return b;
  }

  private codeArea(parent: HTMLElement, readonly: boolean): HTMLTextAreaElement {
    const t = this.el(parent, 'textarea', '',
      'width:100%;height:64px;margin:4px 0;background:#07070d;color:#9fb0d0;' +
      'border:1px solid #3b4a6b;font-family:monospace;font-size:10px;resize:none;');
    t.readOnly = readonly;
    if (readonly) t.onclick = () => t.select();
    return t;
  }

  private note(parent: HTMLElement, text: string): HTMLElement {
    return this.el(parent, 'div', text, 'font-size:11px;color:#8892a8;margin:6px 0;');
  }

  private async copy(text: string, btn: HTMLButtonElement): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      btn.textContent = 'COPIED!';
      setTimeout(() => (btn.textContent = 'COPY CODE'), 1200);
    } catch {
      btn.textContent = 'SELECT + COPY MANUALLY';
    }
  }

  /* ---------------- lobby states ---------------- */

  private buildMenu(): void {
    const box = this.panel();
    this.el(box, 'div', 'CO-OP', 'font-size:18px;color:#ffd166;margin-bottom:4px;');
    this.note(box, 'Two players, one world, no server: you and a friend swap two codes over any chat, then the browsers connect directly.');
    this.button(box, 'HOST GAME', () => void this.buildHost());
    this.button(box, 'JOIN GAME', () => this.buildJoin());
    this.button(box, 'BACK', () => this.close());
  }

  private async buildHost(): Promise<void> {
    const box = this.panel();
    this.el(box, 'div', 'HOST GAME', 'font-size:16px;color:#ffd166;');
    const wait = this.note(box, 'Preparing your invite code...');
    try {
      this.link = await PeerLink.host();
    } catch (err) {
      wait.textContent = `Could not start WebRTC: ${(err as Error).message}`;
      this.button(box, 'BACK', () => this.buildMenu());
      return;
    }
    wait.textContent = '1. Send this invite code to your friend:';
    const out = this.codeArea(box, true);
    out.value = this.link.code;
    const copyBtn = this.button(box, 'COPY CODE', () => void this.copy(out.value, copyBtn));
    this.note(box, "2. Paste your friend's reply code here:");
    const inArea = this.codeArea(box, false);
    const status = this.note(box, '');
    this.link.onOpen = () => this.connected('host');
    this.button(box, 'CONNECT', () => {
      status.textContent = 'Connecting...';
      this.link!.accept(inArea.value).catch((err) => {
        status.textContent = `Bad reply code: ${(err as Error).message}`;
      });
    });
    this.button(box, 'CANCEL', () => { this.link?.close(); this.buildMenu(); });
  }

  private buildJoin(): void {
    const box = this.panel();
    this.el(box, 'div', 'JOIN GAME', 'font-size:16px;color:#ffd166;');
    this.note(box, "1. Paste the host's invite code:");
    const inArea = this.codeArea(box, false);
    const status = this.note(box, '');
    this.button(box, 'ACCEPT INVITE', () => {
      status.textContent = 'Building your reply code...';
      PeerLink.join(inArea.value).then((link) => {
        this.link = link;
        link.onOpen = () => this.connected('guest');
        const box2 = this.panel();
        this.el(box2, 'div', 'JOIN GAME', 'font-size:16px;color:#ffd166;');
        this.note(box2, '2. Send this reply code back to the host:');
        const out = this.codeArea(box2, true);
        out.value = link.code;
        const copyBtn = this.button(box2, 'COPY CODE', () => void this.copy(out.value, copyBtn));
        this.note(box2, 'Waiting for the host to connect...');
        this.button(box2, 'CANCEL', () => { link.close(); this.buildMenu(); });
      }).catch((err) => {
        status.textContent = `Bad invite code: ${(err as Error).message}`;
      });
    });
    this.button(box, 'BACK', () => this.buildMenu());
  }

  render(g: CanvasRenderingContext2D): void {
    g.fillStyle = 'rgba(7,7,13,0.75)';
    g.fillRect(0, 0, this.game.width, this.game.height);
    drawText(g, this.status, this.game.width / 2, this.game.height - 16, COLORS.steel, 1, 'center');
  }
}
