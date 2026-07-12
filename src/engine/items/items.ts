import { Registry } from '../core/registry';
import { StatMods } from './stats';

/**
 * Items, inventory, and equipment.
 *
 * The engine defines the *shape* items share (name, icon, stacking,
 * equipment slot, stat modifiers, use hook) plus the mechanics of holding
 * and equipping them. What items exist, what `use` does, and which slots
 * the game has are all content decisions.
 *
 * The `use`/`onPickup` context is a generic parameter: games pass their
 * own context type (usually { game, player }) and get it back typed.
 */
export interface ItemDef<Ctx = unknown> {
  name: string;
  desc: string;
  /** Small sprite for menus/pickups. */
  icon?: HTMLCanvasElement;
  /**
   * 'consumable' — usable from a menu (use() returns false to abort/keep),
   * 'equipment'  — occupies `slot`, contributes `mods`,
   * 'instant'    — applies on pickup, never enters the inventory,
   * 'key'        — quest/progress item, inert but held.
   */
  kind: 'consumable' | 'equipment' | 'instant' | 'key';
  /** Max per stack (default 1 for equipment/key, 9 otherwise). */
  stack?: number;
  /** Equipment only: which slot this occupies ('weapon', 'armor', 'charm'...). */
  slot?: string;
  /** Equipment only: stat modifiers while equipped. */
  mods?: StatMods;
  /** Free-form extra data (weapon damage specs, projectile ids...). */
  props?: Record<string, unknown>;
  /** consumable: perform the effect. Return false to cancel (don't consume). */
  use?(ctx: Ctx): boolean | void;
  /** instant: applied on pickup. Others: optional pickup side effect. */
  onPickup?(ctx: Ctx): void;
}

/** Global registry of item definitions (content registers into this). */
export const items = new Registry<ItemDef<never>>('item');

export function defineItem<Ctx>(id: string, def: ItemDef<Ctx>): void {
  items.register(id, def as ItemDef<never>);
}

export function itemDef<Ctx = unknown>(id: string): ItemDef<Ctx> {
  return items.get(id) as ItemDef<Ctx>;
}

export interface ItemStack {
  id: string;
  count: number;
}

/** A bag of item stacks. Pure bookkeeping — effects live on the defs. */
export class Inventory {
  slots: ItemStack[] = [];

  count(id: string): number {
    let n = 0;
    for (const s of this.slots) if (s.id === id) n += s.count;
    return n;
  }

  has(id: string): boolean {
    return this.count(id) > 0;
  }

  /** Add n of an item. Returns how many did NOT fit (0 = all added). */
  add(id: string, n = 1, maxSlots = Infinity): number {
    const def = itemDef(id);
    const stackMax = def.stack ?? (def.kind === 'consumable' ? 9 : 1);
    while (n > 0) {
      let slot = this.slots.find((s) => s.id === id && s.count < stackMax);
      if (!slot) {
        if (this.slots.length >= maxSlots) return n;
        slot = { id, count: 0 };
        this.slots.push(slot);
      }
      const take = Math.min(n, stackMax - slot.count);
      slot.count += take;
      n -= take;
    }
    return 0;
  }

  /** Remove n of an item. Returns whether the full amount was removed. */
  remove(id: string, n = 1): boolean {
    if (this.count(id) < n) return false;
    for (let i = this.slots.length - 1; i >= 0 && n > 0; i--) {
      const s = this.slots[i];
      if (s.id !== id) continue;
      const take = Math.min(n, s.count);
      s.count -= take;
      n -= take;
      if (s.count === 0) this.slots.splice(i, 1);
    }
    return true;
  }

  /** Use a consumable: runs def.use, consumes one on success. */
  use<Ctx>(id: string, ctx: Ctx): boolean {
    const def = itemDef<Ctx>(id);
    if (def.kind !== 'consumable' || !def.use || !this.has(id)) return false;
    if (def.use(ctx) === false) return false;
    this.remove(id, 1);
    return true;
  }

  clear(): void {
    this.slots.length = 0;
  }
}

/**
 * Equipment: named slots holding item ids, projecting their stat mods
 * into a Stats object under 'equip:<slot>' sources.
 */
export class Equipment {
  private worn = new Map<string, string>();

  constructor(private stats: import('./stats').Stats) {}

  get(slot: string): string | null {
    return this.worn.get(slot) ?? null;
  }

  isEquipped(id: string): boolean {
    for (const v of this.worn.values()) if (v === id) return true;
    return false;
  }

  /** Equip an equipment item into its slot. Returns the replaced item id, if any. */
  equip(id: string): string | null {
    const def = itemDef(id);
    if (def.kind !== 'equipment' || !def.slot) {
      throw new Error(`item "${id}" is not equippable`);
    }
    const prev = this.get(def.slot);
    this.worn.set(def.slot, id);
    this.stats.setSource(`equip:${def.slot}`, def.mods ?? {});
    return prev;
  }

  unequip(slot: string): string | null {
    const prev = this.get(slot);
    this.worn.delete(slot);
    this.stats.removeSource(`equip:${slot}`);
    return prev;
  }

  slots(): [string, string][] {
    return [...this.worn.entries()];
  }

  clear(): void {
    for (const slot of [...this.worn.keys()]) this.unequip(slot);
  }
}
