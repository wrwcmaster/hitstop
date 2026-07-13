import { Input } from './input';

/**
 * Gamepad support.
 *
 * The Gamepad API is poll-based: call `poll()` once per frame and this
 * class diffs button/axis state against the previous frame, emitting
 * press/release into the same action-based Input everything else uses —
 * so gameplay, menus, dialogue, and shops work with a pad with zero
 * changes to any of them.
 *
 * Buttons follow the "standard" mapping indices
 * (https://w3c.github.io/gamepad/#remapping): 0=A 1=B 2=X 3=Y 4=LB 5=RB
 * 6=LT 7=RT 8=Select 9=Start 12-15=dpad. Analog sticks are exposed as
 * digital directions past a deadzone — right for a pixel platformer.
 */
export interface GamepadAxisMapping<A extends string> {
  index: number;
  neg: A | A[];
  pos: A | A[];
  /** Stick travel needed to register (default 0.35). */
  deadzone?: number;
}

export interface GamepadMapping<A extends string> {
  buttons: Record<number, A | A[]>;
  axes?: GamepadAxisMapping<A>[];
}

function asArray<A>(v: A | A[]): A[] {
  return Array.isArray(v) ? v : [v];
}

export class GamepadInput<A extends string = string> {
  /** True once any mapped gamepad has been seen (for "PAD CONNECTED" UI). */
  connected = false;

  private held = new Set<A>();
  /** Raw button indices down last poll — for capture edge detection. */
  private prevButtons = new Set<number>();
  private captureFn: ((index: number) => void) | null = null;

  constructor(
    private input: Input<A>,
    private mapping: GamepadMapping<A>,
  ) {}

  /** Read all pads and sync action state. Call once per rendered frame. */
  poll(): void {
    if (typeof navigator === 'undefined' || !navigator.getGamepads) return;
    const now = new Set<A>();
    const down = new Set<number>();
    let sawPad = false;

    for (const pad of navigator.getGamepads()) {
      if (!pad || !pad.connected) continue;
      sawPad = true;
      // Collect ALL pressed button indices (not just mapped ones), so a
      // rebind UI can capture any button.
      for (let i = 0; i < pad.buttons.length; i++) {
        const b = pad.buttons[i];
        if (b && (b.pressed || b.value > 0.5)) down.add(i);
      }
      for (const axis of this.mapping.axes ?? []) {
        const v = pad.axes[axis.index] ?? 0;
        const dz = axis.deadzone ?? 0.35;
        if (v <= -dz) for (const a of asArray(axis.neg)) now.add(a);
        if (v >= dz) for (const a of asArray(axis.pos)) now.add(a);
      }
    }
    this.connected = this.connected || sawPad;

    // A rebind UI is listening: hand it the first NEWLY-pressed button and
    // swallow input until it releases (so the button that armed the capture
    // isn't the one bound).
    if (this.captureFn) {
      for (const idx of down) {
        if (!this.prevButtons.has(idx)) {
          const fn = this.captureFn;
          this.captureFn = null;
          this.prevButtons = down;
          fn(idx);
          return;
        }
      }
      this.prevButtons = down;
      return;
    }

    // Map pressed buttons to actions.
    for (const idx of down) {
      const actions = this.mapping.buttons[idx];
      if (actions !== undefined) for (const a of asArray(actions)) now.add(a);
    }

    // Edge-diff into the shared Input.
    for (const a of now) {
      if (!this.held.has(a)) this.input.press(a);
    }
    for (const a of this.held) {
      if (!now.has(a)) this.input.release(a);
    }
    this.held = now;
    this.prevButtons = down;
  }

  /* ---- rebinding (key config UIs) ---- */

  /** Button indices currently bound to an action. */
  buttonsFor(action: A): number[] {
    return Object.keys(this.mapping.buttons)
      .filter((k) => asArray(this.mapping.buttons[Number(k)]).includes(action))
      .map(Number);
  }

  /**
   * Rebind: `index` becomes the ONLY button for `action` (plus aliases,
   * e.g. jump also confirming in menus). Mirrors Input.rebind for keys.
   */
  rebindButton(action: A, index: number, aliases: A[] = []): void {
    for (const key of Object.keys(this.mapping.buttons)) {
      const i = Number(key);
      const rest = asArray(this.mapping.buttons[i]).filter((a) => a !== action);
      if (rest.length) this.mapping.buttons[i] = rest;
      else delete this.mapping.buttons[i];
    }
    this.mapping.buttons[index] = [action, ...aliases];
  }

  /** Snapshot of the button bindings (for settings persistence). */
  getButtonMap(): Record<number, A[]> {
    const out: Record<number, A[]> = {};
    for (const key of Object.keys(this.mapping.buttons)) {
      out[Number(key)] = asArray(this.mapping.buttons[Number(key)]);
    }
    return out;
  }

  /** Replace the button bindings (restoring saved settings / defaults). */
  setButtonMap(map: Record<number, A | A[]>): void {
    this.mapping.buttons = { ...map };
  }

  /** Capture the next new button press as a raw index (rebind UIs). */
  captureNextButton(fn: (index: number) => void): void {
    this.captureFn = fn;
  }

  cancelCapture(): void {
    this.captureFn = null;
  }
}
