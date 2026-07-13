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
