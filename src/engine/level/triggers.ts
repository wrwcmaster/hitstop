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
   */
  update(probe: Rect, fire: (t: TriggerFire) => void): void {
    this.defs.forEach((def, index) => {
      const hit = overlaps(probe, def);
      const wasInside = this.inside.has(index);
      if (hit && !wasInside) {
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

  /** Restore fired state from a save file. */
  importFired(indices: number[]): void {
    this.fired = new Set(indices);
  }
}
