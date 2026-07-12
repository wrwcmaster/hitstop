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
export class Input<A extends string = string> {
  private held_ = new Set<A>();
  private pressed_ = new Set<A>();
  private released_ = new Set<A>();
  private keymap: Record<string, A | A[]>;
  private anyPressListeners: (() => void)[] = [];

  /** A key may map to several actions (ArrowUp = jump in-game AND up in menus). */
  constructor(keymap: Record<string, A | A[]>) {
    this.keymap = keymap;
  }

  private actionsFor(code: string): A[] {
    const a = this.keymap[code];
    return a === undefined ? [] : Array.isArray(a) ? a : [a];
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
    }
    for (const fn of this.anyPressListeners) fn();
  }

  release(a: A): void {
    if (this.held_.has(a)) {
      this.held_.delete(a);
      this.released_.add(a);
    }
  }

  /** Fires on any press from any device — audio unlock, "press any key". */
  onAnyPress(fn: () => void): void {
    this.anyPressListeners.push(fn);
  }

  /** Report a non-action press (canvas tap, unmapped key) to onAnyPress. */
  notifyAnyPress(): void {
    for (const fn of this.anyPressListeners) fn();
  }

  /** Clear edge flags. Called by the Game after each fixed update. */
  endStep(): void {
    this.pressed_.clear();
    this.released_.clear();
  }

  /** Listen to keyboard events on `target` using the keymap. */
  attachKeyboard(target: GlobalEventHandlers = window): void {
    target.addEventListener('keydown', (e: KeyboardEvent) => {
      const actions = this.actionsFor(e.code);
      if (actions.length) {
        e.preventDefault();
        if (!e.repeat) for (const a of actions) this.press(a);
      } else if (!e.repeat) {
        for (const fn of this.anyPressListeners) fn();
      }
    });
    target.addEventListener('keyup', (e: KeyboardEvent) => {
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
