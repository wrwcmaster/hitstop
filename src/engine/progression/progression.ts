import { Registry } from '../core/registry';
import { Stats, StatMods } from '../items/stats';

/**
 * Character progression: experience, levels, skill points, and a skill
 * tree.
 *
 * Progression is the XP ledger — a pluggable curve decides how much XP
 * each level takes; every level gained awards skill points and fires a
 * callback (the game supplies the fanfare).
 *
 * The skill tree is content: TreeNodeDefs in a registry, each with a
 * point cost, prerequisites, and its effect — declarative stat mods
 * (applied for as long as the node is owned) and/or an onUnlock hook
 * (learn a skill, enable a mechanic). The SkillTree runtime tracks
 * what's owned, answers availability queries for the UI, and re-applies
 * effects when a save is restored.
 */

/** XP needed to advance FROM `level` to the next. */
export type LevelCurve = (level: number) => number;

export class Progression {
  xp = 0;
  level = 1;
  skillPoints = 0;

  constructor(
    private curve: LevelCurve,
    /** Points awarded per level (default 1). */
    private pointsPerLevel = 1,
    private onLevelUp?: (newLevel: number) => void,
  ) {}

  get xpToNext(): number {
    return this.curve(this.level);
  }

  /** 0..1 progress toward the next level (HUD bars). */
  get fraction(): number {
    return Math.min(1, this.xp / this.xpToNext);
  }

  /** Add XP; levels cascade. Returns how many levels were gained. */
  addXp(n: number): number {
    this.xp += n;
    let gained = 0;
    while (this.xp >= this.xpToNext) {
      this.xp -= this.xpToNext;
      this.level++;
      this.skillPoints += this.pointsPerLevel;
      gained++;
      this.onLevelUp?.(this.level);
    }
    return gained;
  }

  /** For save files. */
  snapshot(): { xp: number; level: number; skillPoints: number } {
    return { xp: this.xp, level: this.level, skillPoints: this.skillPoints };
  }

  restore(data: { xp: number; level: number; skillPoints: number }): void {
    this.xp = data.xp;
    this.level = data.level;
    this.skillPoints = data.skillPoints;
  }
}

/* ---------------- skill tree ---------------- */

export interface TreeNodeDef<Ctx = unknown> {
  name: string;
  desc: string;
  /** Skill points to unlock. */
  cost: number;
  /** Grid position for the tree UI. */
  branch: number;
  tier: number;
  /** Node ids that must be owned first (default: none). */
  requires?: string[];
  /** Stat modifiers while owned (applied via the tree's Stats host). */
  mods?: StatMods;
  /** Imperative effect: learn a skill, flip a mechanic flag. Re-runs on save restore. */
  onUnlock?(ctx: Ctx): void;
}

export const treeNodes = new Registry<TreeNodeDef<never>>('treeNode');

export function defineTreeNode<Ctx>(id: string, def: TreeNodeDef<Ctx>): void {
  treeNodes.register(id, def as TreeNodeDef<never>);
}

export function treeNodeDef<Ctx = unknown>(id: string): TreeNodeDef<Ctx> {
  return treeNodes.get(id) as TreeNodeDef<Ctx>;
}

export interface TreeHost {
  stats?: Stats;
  syncStats?(): void;
}

export class SkillTree<Ctx = unknown> {
  private owned = new Set<string>();

  constructor(private host: TreeHost) {}

  has(id: string): boolean {
    return this.owned.has(id);
  }

  ownedIds(): string[] {
    return [...this.owned];
  }

  /** Are prerequisites met (ignoring cost)? */
  reachable(id: string): boolean {
    const def = treeNodeDef(id);
    return (def.requires ?? []).every((r) => this.owned.has(r));
  }

  /** Could `unlock` succeed right now? */
  available(id: string, points: number): boolean {
    if (this.owned.has(id)) return false;
    const def = treeNodeDef(id);
    return this.reachable(id) && points >= def.cost;
  }

  /**
   * Unlock a node: spends from `progression`, applies effects.
   * Returns whether it happened.
   */
  unlock(id: string, progression: Progression, ctx: Ctx): boolean {
    if (!this.available(id, progression.skillPoints)) return false;
    progression.skillPoints -= treeNodeDef(id).cost;
    this.owned.add(id);
    this.applyEffects(id, ctx);
    return true;
  }

  /** Restore owned nodes from a save and re-apply every effect (no cost). */
  restore(ids: string[], ctx: Ctx): void {
    for (const id of ids) {
      if (!treeNodes.has(id)) continue; // node removed in an update; skip gracefully
      if (this.owned.has(id)) continue;
      this.owned.add(id);
      this.applyEffects(id, ctx);
    }
  }

  private applyEffects(id: string, ctx: Ctx): void {
    const def = treeNodeDef<Ctx>(id);
    if (def.mods && this.host.stats) {
      this.host.stats.setSource(`tree:${id}`, def.mods);
      this.host.syncStats?.();
    }
    def.onUnlock?.(ctx);
  }
}

/* ---------------- earned unlocks ---------------- */

/**
 * Something a run can EARN and keep for good.
 *
 * This is the mechanism behind permanent progression, and it stays
 * deliberately silent about what an unlock *means*. Games express the
 * same idea very differently — a key item you carry, a unique skill that
 * sits off the normal tree, a bare traversal verb with no inventory
 * presence at all — and all three are the same bookkeeping: an id you own
 * from some moment onward, which survives everything else being rebuilt.
 *
 * So the engine owns the ledger and `kind` is an OPAQUE label the game
 * gives meaning to ('keyItem', 'skill', 'ability', whatever fits). How an
 * unlock manifests is the game's business, expressed through `onEarn`.
 *
 * Distinct from `SkillTree`, which is the neighbouring mechanism: tree
 * nodes cost points, belong to a class, and are torn down and replayed
 * when that class changes. An earnable has no cost and no owner but the
 * character, which is exactly why it can't live in a tree.
 */
export interface EarnableDef<Ctx = unknown> {
  name: string;
  desc: string;
  /**
   * Free-form category the GAME interprets — the engine only carries it.
   * Lets one catalog hold key items, off-tree skills, and plain verbs
   * together, with the UI deciding how each is presented.
   */
  kind?: string;
  /**
   * How this unlock manifests: hand over an item, teach a skill, enable a
   * capability. Optional — an unlock that content merely *queries* needs
   * no projection at all.
   *
   * IMPORTANT: this RE-RUNS on `restore`, exactly as `TreeNodeDef
   * .onUnlock` does, because projections into non-persisted state
   * (capabilities, derived flags) would otherwise be lost on load. It
   * must therefore be idempotent. Beware targets that are themselves
   * saved AND non-idempotent — `Inventory.add` stacks, so a key-item
   * projection should guard on already having the item.
   */
  onEarn?(ctx: Ctx): void;
}

export const earnables = new Registry<EarnableDef<never>>('earnable');

export function defineEarnable<Ctx>(id: string, def: EarnableDef<Ctx>): void {
  earnables.register(id, def as EarnableDef<never>);
}

export function earnableDef<Ctx = unknown>(id: string): EarnableDef<Ctx> {
  return earnables.get(id) as EarnableDef<Ctx>;
}

/**
 * The set of unlocks a character has earned.
 *
 * Nothing here is scoped to a class, a room, or a run phase: once earned,
 * an id stays until the save says otherwise. Rebuilding a class, a room,
 * or the whole world leaves it untouched.
 */
export class EarnedSet<Ctx = unknown> {
  private owned = new Set<string>();

  has(id: string): boolean {
    return this.owned.has(id);
  }

  /**
   * Earn an unlock, running its projection. Returns true only the FIRST
   * time, which is what lets one-shot presentation (a fanfare, a prompt)
   * key off the return and never repeat — earning the same thing twice
   * is a no-op, not a second celebration.
   */
  grant(id: string, ctx: Ctx): boolean {
    if (!earnables.has(id)) {
      throw new Error(`earnable "${id}": not registered`);
    }
    if (this.owned.has(id)) return false;
    this.owned.add(id);
    earnableDef<Ctx>(id).onEarn?.(ctx);
    return true;
  }

  /**
   * Restore from a save: re-apply every projection, at no cost and with
   * no first-time reporting. Ids that no longer exist are skipped rather
   * than throwing, so a save outlives content being renamed or dropped.
   */
  restore(ids: readonly string[] | undefined, ctx: Ctx): void {
    this.owned.clear();
    for (const id of ids ?? []) {
      if (!earnables.has(id)) continue;
      this.owned.add(id);
      earnableDef<Ctx>(id).onEarn?.(ctx);
    }
  }

  /**
   * Re-run every owned projection without changing what is owned.
   *
   * Needed whenever something downstream is torn down and rebuilt under
   * a character who has already earned things — a class change being the
   * usual case, since it clears the skill book and capabilities. Without
   * this, an unlock that manifests as a skill or a capability would go
   * quietly dead until the next load, even though it is still owned.
   * Safe to call at any time: projections are required to be idempotent.
   */
  reapply(ctx: Ctx): void {
    for (const id of this.list()) earnableDef<Ctx>(id).onEarn?.(ctx);
  }

  /** Owned ids in registration order, so saves stay stable run to run. */
  list(): string[] {
    return earnables.ids().filter((id) => this.owned.has(id));
  }
}
