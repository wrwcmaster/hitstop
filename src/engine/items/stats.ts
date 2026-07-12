/**
 * Stats with sourced modifiers.
 *
 * An actor has base stats; equipment, buffs, and curses contribute
 * modifiers under a *source key* so they can be removed cleanly when the
 * item is unequipped or the buff expires. Additive first, then
 * multiplicative:
 *
 *   final = (base + Σ add) × Π mult
 *
 * Stat names are game-defined strings ('maxHp', 'attack', 'speed'...).
 */
export interface StatMods {
  add?: Record<string, number>;
  mult?: Record<string, number>;
}

export class Stats {
  private sources = new Map<string, StatMods>();

  constructor(public base: Record<string, number>) {}

  /** Set (or replace) a source's modifiers — e.g. setSource('weapon', item.mods). */
  setSource(source: string, mods: StatMods): void {
    this.sources.set(source, mods);
  }

  removeSource(source: string): void {
    this.sources.delete(source);
  }

  get(stat: string): number {
    let v = this.base[stat] ?? 0;
    let mult = 1;
    for (const mods of this.sources.values()) {
      v += mods.add?.[stat] ?? 0;
      mult *= mods.mult?.[stat] ?? 1;
    }
    return v * mult;
  }

  /** All stat names that have a base or any modifier (for UI). */
  names(): string[] {
    const set = new Set(Object.keys(this.base));
    for (const mods of this.sources.values()) {
      for (const k of Object.keys(mods.add ?? {})) set.add(k);
      for (const k of Object.keys(mods.mult ?? {})) set.add(k);
    }
    return [...set];
  }
}
