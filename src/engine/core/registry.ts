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
    if (this.items.has(id)) {
      console.warn(`[registry:${this.kind}] overwriting existing id "${id}"`);
    }
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
