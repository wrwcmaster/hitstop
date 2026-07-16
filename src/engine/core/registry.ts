/**
 * A named registry of content definitions (enemy types, tile types, skills,
 * particle presets...). Content files call `register` at import time; game
 * systems look definitions up by id. This is the backbone of the
 * data-driven design: adding a new enemy never touches engine code.
 */
export class Registry<T> {
  private items = new Map<string, T>();

  constructor(public readonly kind: string) {}

  register(id: string, def: T): T {
    // A duplicate id is almost always a typo or a content collision —
    // fail loudly at registration, where the fix is obvious, instead of
    // silently shadowing a definition and failing later during play.
    // Intentional overrides (hot reload, mods) use replace().
    if (this.items.has(id)) {
      throw new Error(`[registry:${this.kind}] duplicate id "${id}" — use replace() to override deliberately`);
    }
    this.items.set(id, def);
    return def;
  }

  /** Deliberately override (or add) a definition. */
  replace(id: string, def: T): T {
    this.items.set(id, def);
    return def;
  }

  get(id: string): T {
    const def = this.items.get(id);
    if (!def) throw new Error(`[registry:${this.kind}] unknown id "${id}"`);
    return def;
  }

  has(id: string): boolean {
    return this.items.has(id);
  }

  ids(): string[] {
    return [...this.items.keys()];
  }

  entries(): [string, T][] {
    return [...this.items.entries()];
  }
}
