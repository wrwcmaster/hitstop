/**
 * Action-based input.
 *
 * Gameplay code never reads keys — it reads *actions* ("jump", "attack",
 * "left"). Keyboard keys and touch buttons are bound to actions, so
 * rebinding, touch controls, and future gamepad support never touch
 * gameplay code.
 *
 * Edge detection (`pressed` / `released`) is per simulation step: the Game
 * calls `endStep()` after each fixed update, so a press is visible for
 * exactly one update no matter the frame rate.
 */
/** An effective input event, post device mapping (see Input.onRaw). */
export type RawInputEvent<A extends string> =
  | { t: 'down' | 'up'; a: A }
  | { t: 'tap'; x: number; y: number };

export class Input<A extends string = string> {
  private held_ = new Set<A>();
  private pressed_ = new Set<A>();
  private released_ = new Set<A>();
  private keymap: Record<string, A | A[]>;
  private anyPressListeners: (() => void)[] = [];
  private rawListeners: ((ev: RawInputEvent<A>) => void)[] = [];
  private captureFn: ((code: string) => void) | null = null;
  /** Latest tap in logical (screen-space) coords, for menu hit-testing. */
  private tap_: { x: number; y: number } | null = null;

  /** A key may map to several actions (ArrowUp = jump in-game AND up in menus). */
  constructor(keymap: Record<string, A | A[]>) {
    this.keymap = { ...keymap };
  }

  /**
   * Observe every effective input event — action edges and taps — after
   * device mapping. This is the recording seam: whatever the device
   * (keyboard, touch, gamepad, a test), the sim only ever sees these
   * events, so a log of them replays the run. Returns an unsubscribe.
   */
  onRaw(fn: (ev: RawInputEvent<A>) => void): () => void {
    this.rawListeners.push(fn);
    return () => {
      const i = this.rawListeners.indexOf(fn);
      if (i >= 0) this.rawListeners.splice(i, 1);
    };
  }

  private emitRaw(ev: RawInputEvent<A>): void {
    for (const fn of this.rawListeners) fn(ev);
  }

  private actionsFor(code: string): A[] {
    const a = this.keymap[code];
    return a === undefined ? [] : Array.isArray(a) ? a : [a];
  }

  /* ---- rebinding (key config UIs) ---- */

  /** Snapshot of the current bindings (for settings persistence). */
  getKeymap(): Record<string, A[]> {
    const out: Record<string, A[]> = {};
    for (const code of Object.keys(this.keymap)) out[code] = this.actionsFor(code);
    return out;
  }

  /** Replace all bindings (restoring saved settings / defaults). */
  setKeymap(map: Record<string, A | A[]>): void {
    this.keymap = { ...map };
  }

  /** Key codes currently bound to an action. */
  codesFor(action: A): string[] {
    return Object.keys(this.keymap).filter((c) => this.actionsFor(c).includes(action));
  }

  /**
   * Rebind: `code` becomes the ONLY key for `action` (plus any listed
   * aliases, e.g. jump also acting as menu-up). The code's previous
   * bindings are dropped; other keys lose this action.
   */
  rebind(action: A, code: string, aliases: A[] = []): void {
    for (const c of Object.keys(this.keymap)) {
      const rest = this.actionsFor(c).filter((a) => a !== action);
      if (rest.length) this.keymap[c] = rest;
      else delete this.keymap[c];
    }
    this.keymap[code] = [action, ...aliases];
  }

  /**
   * Capture the next keydown as a raw code (rebind UIs) instead of
   * processing it as an action. The callback receives e.code.
   */
  captureNextKey(fn: (code: string) => void): void {
    this.captureFn = fn;
  }

  /** Abandon a pending captureNextKey (touch users have no Escape). */
  cancelCapture(): void {
    this.captureFn = null;
  }

  /** Is the action currently down? */
  held(a: A): boolean {
    return this.held_.has(a);
  }

  /** Did the action go down during this simulation step? */
  pressed(a: A): boolean {
    return this.pressed_.has(a);
  }

  /** Did the action go up during this simulation step? */
  released(a: A): boolean {
    return this.released_.has(a);
  }

  /** -1/0/+1 helper for a pair of actions (e.g. axis('left','right')). */
  axis(neg: A, pos: A): number {
    return (this.held(pos) ? 1 : 0) - (this.held(neg) ? 1 : 0);
  }

  /** Consume a press so no one else sees it this step. Returns whether it was pressed. */
  consumePress(a: A): boolean {
    const was = this.pressed_.has(a);
    this.pressed_.delete(a);
    return was;
  }

  /** Programmatic press (touch buttons, gamepad polling, replays, tests). */
  press(a: A): void {
    if (!this.held_.has(a)) {
      this.held_.add(a);
      this.pressed_.add(a);
      this.emitRaw({ t: 'down', a });
    }
    for (const fn of this.anyPressListeners) fn();
  }

  release(a: A): void {
    if (this.held_.has(a)) {
      this.held_.delete(a);
      this.released_.add(a);
      this.emitRaw({ t: 'up', a });
    }
  }

  /** Fires on any press from any device — audio unlock, "press any key".
   * Returns an unsubscribe, so scene-lifetime listeners can be released. */
  onAnyPress(fn: () => void): () => void {
    this.anyPressListeners.push(fn);
    return () => {
      const i = this.anyPressListeners.indexOf(fn);
      if (i >= 0) this.anyPressListeners.splice(i, 1);
    };
  }

  /** Report a non-action press (canvas tap, unmapped key) to onAnyPress. */
  notifyAnyPress(): void {
    for (const fn of this.anyPressListeners) fn();
  }

  /** Record a tap at logical (screen) coords — see consumeTap / Menu.tapAt. */
  notifyTap(x: number, y: number): void {
    this.tap_ = { x, y };
    this.emitRaw({ t: 'tap', x, y });
  }

  /** Consume this step's tap position (once), for menu/pointer hit-testing. */
  consumeTap(): { x: number; y: number } | null {
    const t = this.tap_;
    this.tap_ = null;
    return t;
  }

  /** Clear edge flags. Called by the Game after each fixed update. */
  endStep(): void {
    this.pressed_.clear();
    this.released_.clear();
    this.tap_ = null; // a tap is live for exactly one step, like a press edge
  }

  /** Listen to keyboard events on `target` using the keymap. */
  attachKeyboard(target: GlobalEventHandlers = window): void {
    // Typing into a form field (a name box, a paste-a-code textarea) must
    // never drive game actions — nor be eaten by their preventDefault.
    const editable = (e: KeyboardEvent): boolean => {
      const t = e.target as HTMLElement | null;
      return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
    };
    target.addEventListener('keydown', (e: KeyboardEvent) => {
      if (editable(e)) return;
      // A rebind UI is listening: hand it the raw code instead.
      if (this.captureFn) {
        e.preventDefault();
        const fn = this.captureFn;
        this.captureFn = null;
        fn(e.code);
        return;
      }
      const actions = this.actionsFor(e.code);
      if (actions.length) {
        e.preventDefault();
        if (!e.repeat) for (const a of actions) this.press(a);
      } else if (!e.repeat) {
        for (const fn of this.anyPressListeners) fn();
      }
    });
    target.addEventListener('keyup', (e: KeyboardEvent) => {
      if (editable(e)) return;
      for (const a of this.actionsFor(e.code)) this.release(a);
    });
  }

  /** Bind a DOM element as a touch button for an action. */
  bindTouchButton(el: HTMLElement, a: A): void {
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.press(a);
    });
    const up = () => this.release(a);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('pointerleave', up);
  }
}

/**
 * Input buffering: remember a press for a short window so slightly-early
 * inputs still count. THE classic game-feel trick — pressing jump 80ms
 * before landing should still jump on landing. Also used for coyote time
 * (buffer "on ground" instead of a press).
 */
export class Buffer {
  private t = 0;

  constructor(private window: number) {}

  /** Arm the buffer (a press happened / a condition was true). */
  set(): void {
    this.t = this.window;
  }

  /** Tick down. Call once per update. */
  update(dt: number): void {
    this.t = Math.max(0, this.t - dt);
  }

  /** Is the buffer still live? */
  get active(): boolean {
    return this.t > 0;
  }

  /** Use it up (returns whether it was active). */
  consume(): boolean {
    const was = this.t > 0;
    this.t = 0;
    return was;
  }
}
