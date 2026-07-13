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

  constructor(
    private input: Input<A>,
    private mapping: GamepadMapping<A>,
  ) {}

  /** Read all pads and sync action state. Call once per rendered frame. */
  poll(): void {
    if (typeof navigator === 'undefined' || !navigator.getGamepads) return;
    const now = new Set<A>();
    let sawPad = false;

    for (const pad of navigator.getGamepads()) {
      if (!pad || !pad.connected) continue;
      sawPad = true;
      for (const [idxStr, actions] of Object.entries(this.mapping.buttons)) {
        const b = pad.buttons[Number(idxStr)];
        if (b && (b.pressed || b.value > 0.5)) {
          for (const a of asArray(actions)) now.add(a);
        }
      }
      for (const axis of this.mapping.axes ?? []) {
        const v = pad.axes[axis.index] ?? 0;
        const dz = axis.deadzone ?? 0.35;
        if (v <= -dz) for (const a of asArray(axis.neg)) now.add(a);
        if (v >= dz) for (const a of asArray(axis.pos)) now.add(a);
      }
    }
    this.connected = this.connected || sawPad;

    // Edge-diff into the shared Input.
    for (const a of now) {
      if (!this.held.has(a)) this.input.press(a);
    }
    for (const a of this.held) {
      if (!now.has(a)) this.input.release(a);
    }
    this.held = now;
  }
}
