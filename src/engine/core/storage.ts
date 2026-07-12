/**
 * Versioned localStorage JSON store — the persistence primitive for
 * saves, settings, and editor state. A version bump invalidates old
 * data instead of letting stale shapes crash the game.
 */
export class JsonStore<T> {
  constructor(
    private key: string,
    private version: number,
  ) {}

  exists(): boolean {
    return this.load() !== null;
  }

  load(): T | null {
    try {
      const raw = localStorage.getItem(this.key);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as { v: number; data: T };
      if (parsed.v !== this.version) return null;
      return parsed.data;
    } catch {
      return null;
    }
  }

  save(data: T): void {
    try {
      localStorage.setItem(this.key, JSON.stringify({ v: this.version, data }));
    } catch {
      // Storage full or blocked — saving is best-effort.
    }
  }

  clear(): void {
    localStorage.removeItem(this.key);
  }
}
