/**
 * Versioned localStorage JSON store — the persistence primitive for
 * saves, settings, and editor state. A version bump invalidates old
 * data instead of letting stale shapes crash the game.
 *
 * All stores read/write through a swappable backing, so a replay viewer
 * can sandbox persistence in memory (the tape's saves load, the player's
 * real storage stays untouched).
 */
interface StorageBacking {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
  snapshot(prefix: string): Record<string, string>;
}

let backing: StorageBacking = {
  get: (k) => localStorage.getItem(k),
  set: (k, v) => localStorage.setItem(k, v),
  remove: (k) => localStorage.removeItem(k),
  snapshot: (prefix) => {
    const out: Record<string, string> = {};
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)!;
      if (k.startsWith(prefix)) out[k] = localStorage.getItem(k)!;
    }
    return out;
  },
};

/** Route all stores to an in-memory sandbox pre-seeded with `seed`. */
export function sandboxStorage(seed: Record<string, string>): void {
  const m = new Map(Object.entries(seed));
  backing = {
    get: (k) => m.get(k) ?? null,
    set: (k, v) => void m.set(k, v),
    remove: (k) => void m.delete(k),
    snapshot: (prefix) => {
      const out: Record<string, string> = {};
      for (const [k, v] of m) if (k.startsWith(prefix)) out[k] = v;
      return out;
    },
  };
}

/** Every stored key/value under `prefix` — what a recording carries. */
export function snapshotStorage(prefix: string): Record<string, string> {
  return backing.snapshot(prefix);
}

/**
 * An autosave plus N manual slots over JsonStores — the standard save-
 * slot shape. Slot 0 is the autosave at `key`; slots 1..N live at
 * `key.slot<i>`. `newest()` picks the most recent by the game-supplied
 * timestamp (for a CONTINUE entry).
 */
export class SlotVault<T> {
  private stores: JsonStore<T>[];

  constructor(
    key: string,
    version: number,
    /** Manual slots (the vault holds this + 1 counting the autosave). */
    readonly slots: number,
    private stampOf: (data: T) => number,
  ) {
    this.stores = [
      new JsonStore<T>(key, version),
      ...Array.from({ length: slots }, (_, i) => new JsonStore<T>(`${key}.slot${i + 1}`, version)),
    ];
  }

  /** Store for a slot: 0 = autosave, 1..slots = manual. */
  store(slot: number): JsonStore<T> {
    return this.stores[slot];
  }

  /** The most recent save across the autosave and every slot. */
  newest(): T | null {
    let best: T | null = null;
    for (const s of this.stores) {
      const d = s.load();
      if (d && (!best || this.stampOf(d) > this.stampOf(best))) best = d;
    }
    return best;
  }
}

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
      const raw = backing.get(this.key);
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
      backing.set(this.key, JSON.stringify({ v: this.version, data }));
    } catch {
      // Storage full or blocked — saving is best-effort.
    }
  }

  clear(): void {
    backing.remove(this.key);
  }
}
