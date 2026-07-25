import { abilityOrder, worldAbilities } from '../content/abilities';

/**
 * The permanent verbs this knight has earned from bosses.
 *
 * Separate from `PlayerCapabilities` on purpose: capabilities are the
 * class kit and are wiped and replayed on every class change, while a
 * boss reward is the player's for good. Nothing here is touched by
 * `setClass`, so respeccing can never cost you a traversal verb.
 *
 * `grant` reports whether the ability was NEW, which is what keeps
 * unlock feedback honest — loading a save or replaying a run restores
 * ownership through `restore`, which is silent, so the fanfare fires
 * exactly once, when the boss actually falls.
 */
export class WorldAbilities {
  private owned = new Set<string>();

  has(id: string): boolean {
    return this.owned.has(id);
  }

  /**
   * Earn an ability. Returns true only the first time, so one-shot
   * unlock effects can key off the return and never repeat — killing a
   * boss twice, or reloading afterwards, grants nothing further.
   */
  grant(id: string): boolean {
    if (!worldAbilities.has(id)) {
      throw new Error(`world ability "${id}": not registered (see content/abilities.ts)`);
    }
    if (this.owned.has(id)) return false;
    this.owned.add(id);
    return true;
  }

  /** Owned ids in catalog order, so saves and snapshots stay stable. */
  list(): string[] {
    return abilityOrder().filter((id) => this.owned.has(id));
  }

  /**
   * Replay a saved set. Silent (no unlock effects) and idempotent, and
   * ids that no longer exist are dropped rather than throwing — a save
   * must survive content being renamed or removed. An absent list is an
   * old save from before abilities existed: it simply owns none.
   */
  restore(ids: readonly string[] | undefined): void {
    this.owned.clear();
    for (const id of ids ?? []) {
      if (worldAbilities.has(id)) this.owned.add(id);
    }
  }
}
