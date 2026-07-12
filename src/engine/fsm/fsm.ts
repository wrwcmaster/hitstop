/**
 * Minimal state machine for actor behavior (player states, enemy AI,
 * boss phases). States are named objects with enter/update/exit; `t` is
 * time-in-state, which covers most attack/timing logic without extra
 * timers.
 */
export interface StateDef<Ctx> {
  enter?(ctx: Ctx): void;
  /** Return a state name to transition, or nothing to stay. */
  update?(ctx: Ctx, dt: number): string | void;
  exit?(ctx: Ctx): void;
}

export class FSM<Ctx> {
  /** Time in the current state, in seconds. */
  t = 0;
  private current: string;

  constructor(
    private ctx: Ctx,
    private states: Record<string, StateDef<Ctx>>,
    initial: string,
  ) {
    this.current = initial;
    this.states[initial]?.enter?.(ctx);
  }

  get state(): string {
    return this.current;
  }

  is(...names: string[]): boolean {
    return names.includes(this.current);
  }

  /** Force a transition (runs exit/enter even if it's the same state). */
  set(name: string): void {
    if (!this.states[name]) throw new Error(`FSM: unknown state "${name}"`);
    this.states[this.current]?.exit?.(this.ctx);
    this.current = name;
    this.t = 0;
    this.states[name].enter?.(this.ctx);
  }

  update(dt: number): void {
    this.t += dt;
    const next = this.states[this.current]?.update?.(this.ctx, dt);
    if (next && next !== this.current) this.set(next);
  }
}
