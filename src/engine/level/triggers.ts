import { Rect, overlaps } from '../math/rect';

/**
 * Level triggers: rectangular regions that fire a named event when a
 * probe (usually the player) enters them. This is how rooms script
 * things without code: conversations, ambushes, checkpoints, doors,
 * cutscene starts. The game decides what each event name means by
 * listening for it.
 */
export interface TriggerDef extends Rect {
  /** Event name fired on entry (game-defined meaning). */
  event: string;
  /** Fire only once per reset (default true). */
  once?: boolean;
  /** Free-form payload passed to the handler. */
  props?: Record<string, unknown>;
}

export interface TriggerFire {
  def: TriggerDef;
  index: number;
}

export class Triggers {
  private fired = new Set<number>();
  private inside = new Set<number>();

  constructor(public defs: TriggerDef[]) {}

  /**
   * Test the probe against all triggers; `fire` is called on entry
   * (edge-triggered — staying inside doesn't refire).
   *
   * `gate` (optional) may hold a trigger at the threshold: when it
   * returns false for a def about to fire, the entry is NOT recorded —
   * not fired, not even "inside" — so the trigger re-tests every frame
   * and fires the moment the gate opens, without the probe stepping out
   * and back. This is how a game defers a firing on a condition the
   * trigger rectangle can't express (a co-op partner not yet gathered)
   * while keeping once-semantics honest: a gated trigger has not fired.
   */
  update(probe: Rect, fire: (t: TriggerFire) => void, gate?: (def: TriggerDef) => boolean): void {
    this.defs.forEach((def, index) => {
      const hit = overlaps(probe, def);
      const wasInside = this.inside.has(index);
      if (hit && !wasInside) {
        if (gate && !this.fired.has(index) && !gate(def)) return;
        this.inside.add(index);
        if (!this.fired.has(index)) {
          if (def.once !== false) this.fired.add(index);
          fire({ def, index });
        }
      } else if (!hit && wasInside) {
        this.inside.delete(index);
      }
    });
  }

  /**
   * Mark every trigger the probe already overlaps as entered, WITHOUT
   * firing it. For a probe that was placed rather than moved: you
   * materialize inside a doorway when you arrive through it, and
   * "entering" is supposed to mean crossing the boundary. Without this
   * the door you just used fires again the moment its condition is met
   * and hands you straight back — the exact loop `rearm` exists to
   * unstick from the other direction.
   *
   * `accept` narrows which kinds are primed, because not every trigger
   * wants it: a conversation you are standing in on arrival SHOULD
   * greet you.
   */
  prime(probe: Rect, accept?: (def: TriggerDef) => boolean): void {
    this.defs.forEach((def, index) => {
      if (accept && !accept(def)) return;
      if (overlaps(probe, def)) this.inside.add(index);
    });
  }

  /**
   * Forget that the probe is inside `index`, so the next overlap counts
   * as a fresh entry.
   *
   * For a trigger whose MEANING changed while the probe stood in it: a
   * sealed door that just unsealed has already had its one entry, and
   * without this it stays inert until you step out and back — which,
   * standing in the doorway as the boss dies, reads as the door being
   * broken.
   */
  rearm(index: number): void {
    this.inside.delete(index);
  }

  /** Forget fired state (new run / room reload). */
  reset(): void {
    this.fired.clear();
    this.inside.clear();
  }

  /** Fired once-trigger indices, for save files. */
  exportFired(): number[] {
    return [...this.fired];
  }

  /**
   * Restore fired state from a save file.
   *
   * Saves store INDICES, and a room's trigger list can change between
   * the build that wrote the save and the build loading it. A repeating
   * trigger can never legitimately be in the fired set (update() only
   * records once-triggers), so any imported index that lands on one is
   * stale by definition — from a room whose triggers have since been
   * reordered — and keeping it would permanently kill that trigger for
   * this save. That was a door once: an old save's indices landed on
   * the vault doorway and quietly welded it shut.
   */
  importFired(indices: number[]): void {
    this.fired = new Set(indices.filter((i) => this.defs[i]?.once !== false));
  }
}
