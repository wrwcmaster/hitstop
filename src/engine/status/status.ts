import { Registry } from '../core/registry';
import { Actor } from '../world/entity';
import { Stats } from '../items/stats';

/**
 * Buffs and debuffs.
 *
 * A StatusDef is content: an id, a color (HUD chip + particles), a
 * default duration, optional stat modifiers (applied for as long as the
 * status is active, via the owner's Stats under a removable source key),
 * an optional periodic tick (poison, regen), and apply/expire hooks.
 *
 * The Statuses bag is the per-actor runtime. Re-applying an active
 * status refreshes its duration (no stacking by default — `stacks`
 * opts in).
 */
export interface StatusDef {
  name: string;
  /** HUD chip / particle color. */
  color: string;
  /** Default duration in seconds (apply() can override). */
  duration: number;
  /** Stat modifiers while active (needs the owner to have Stats). */
  mods?: import('../items/stats').StatMods;
  /** Seconds between onTick calls (omit for no ticking). */
  tickEvery?: number;
  /** While active, the owner's brain halts (frozen, petrified, stunned):
   * actors that honor it skip their AI/def update and stop moving. */
  halts?: boolean;
  /** Translucent encasing overlay drawn over the owner (ice, amber...). */
  veil?: string;
  onApply?(owner: Actor): void;
  onTick?(owner: Actor): void;
  onExpire?(owner: Actor): void;
}

export const statuses = new Registry<StatusDef>('status');

export function defineStatus(id: string, def: StatusDef): void {
  statuses.register(id, def);
}

interface ActiveStatus {
  def: StatusDef;
  remaining: number;
  duration: number;
  tickT: number;
}

/** An actor that can carry stat modifiers (the Player qualifies). */
export interface StatusHost extends Actor {
  stats?: Stats;
  /** Called when a status changes stat mods (re-derive maxHp etc). */
  syncStats?(): void;
}

export class Statuses {
  private active = new Map<string, ActiveStatus>();

  constructor(private owner: StatusHost) {}

  /** Apply (or refresh) a status. */
  apply(id: string, duration?: number): void {
    const def = statuses.get(id);
    const dur = duration ?? def.duration;
    const existing = this.active.get(id);
    if (existing) {
      existing.remaining = Math.max(existing.remaining, dur);
      existing.duration = Math.max(existing.duration, dur);
      return;
    }
    this.active.set(id, { def, remaining: dur, duration: dur, tickT: def.tickEvery ?? 0 });
    if (def.mods && this.owner.stats) {
      this.owner.stats.setSource(`status:${id}`, def.mods);
      this.owner.syncStats?.();
    }
    def.onApply?.(this.owner);
  }

  remove(id: string): void {
    const a = this.active.get(id);
    if (!a) return;
    this.active.delete(id);
    if (a.def.mods && this.owner.stats) {
      this.owner.stats.removeSource(`status:${id}`);
      this.owner.syncStats?.();
    }
    a.def.onExpire?.(this.owner);
  }

  has(id: string): boolean {
    return this.active.has(id);
  }

  /** Any active status that halts the owner's brain (frozen, stunned). */
  get halted(): boolean {
    for (const a of this.active.values()) if (a.def.halts) return true;
    return false;
  }

  /** 0..1 fraction of duration left (for HUD bars). */
  fraction(id: string): number {
    const a = this.active.get(id);
    return a ? a.remaining / a.duration : 0;
  }

  /** Active statuses for HUD rendering. */
  list(): { id: string; def: StatusDef; fraction: number }[] {
    return [...this.active.entries()].map(([id, a]) => ({
      id,
      def: a.def,
      fraction: a.remaining / a.duration,
    }));
  }

  update(dt: number): void {
    for (const [id, a] of [...this.active.entries()]) {
      a.remaining -= dt;
      if (a.def.tickEvery && a.def.onTick) {
        a.tickT -= dt;
        if (a.tickT <= 0) {
          a.tickT += a.def.tickEvery;
          a.def.onTick(this.owner);
        }
      }
      if (a.remaining <= 0) this.remove(id);
    }
  }

  clear(): void {
    for (const id of [...this.active.keys()]) this.remove(id);
  }
}
