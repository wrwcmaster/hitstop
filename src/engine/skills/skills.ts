import { Registry } from '../core/registry';

/**
 * Skills: active abilities with cooldowns and resource costs — sword
 * arts, spells, dashes-with-cooldowns, summons.
 *
 * A SkillDef is content: data + a cast callback (which typically spawns
 * a Strike or a Projectile, so feedback comes free). The SkillBook is the
 * per-actor runtime: cooldown tracking and resource gating. The resource
 * (mana, stamina, ammo) is abstracted behind two callbacks so the engine
 * doesn't care what it is.
 */
export interface SkillDef<Ctx = unknown> {
  name: string;
  desc: string;
  icon?: HTMLCanvasElement;
  /** Seconds between casts. */
  cooldown: number;
  /** Resource cost (whatever the SkillBook's owner says that means). */
  cost?: number;
  /**
   * Perform the skill. Return false to abort (bad aim, no target...) —
   * no cooldown or cost is charged on abort.
   */
  cast(ctx: Ctx): boolean | void;
}

export const skills = new Registry<SkillDef<never>>('skill');

export function defineSkill<Ctx>(id: string, def: SkillDef<Ctx>): void {
  skills.register(id, def as SkillDef<never>);
}

export function skillDef<Ctx = unknown>(id: string): SkillDef<Ctx> {
  return skills.get(id) as SkillDef<Ctx>;
}

export interface ResourcePool {
  /** Can the owner pay this cost right now? */
  canAfford(cost: number): boolean;
  /** Pay it (only called after a successful cast). */
  spend(cost: number): void;
}

/** Per-actor skill runtime: cooldowns + resource gating. */
export class SkillBook<Ctx = unknown> {
  /** Skill ids this actor knows, in hotbar order. */
  known: string[] = [];
  private cooldowns = new Map<string, number>();

  constructor(
    private pool: ResourcePool,
    /** Live cooldown multiplier (skill-tree haste effects). Default 1. */
    private cooldownScale?: () => number,
  ) {}

  learn(id: string): void {
    skillDef(id); // validate
    if (!this.known.includes(id)) this.known.push(id);
  }

  knows(id: string): boolean {
    return this.known.includes(id);
  }

  /** Seconds of cooldown remaining (0 = ready). */
  cooldownLeft(id: string): number {
    return this.cooldowns.get(id) ?? 0;
  }

  ready(id: string): boolean {
    const def = skillDef(id);
    return this.knows(id) && this.cooldownLeft(id) <= 0 && this.pool.canAfford(def.cost ?? 0);
  }

  /** Try to cast. Returns whether it happened. */
  cast(id: string, ctx: Ctx): boolean {
    if (!this.ready(id)) return false;
    const def = skillDef<Ctx>(id);
    if (def.cast(ctx) === false) return false;
    this.pool.spend(def.cost ?? 0);
    this.cooldowns.set(id, def.cooldown * (this.cooldownScale?.() ?? 1));
    return true;
  }

  update(dt: number): void {
    for (const [id, t] of this.cooldowns) {
      if (t > 0) this.cooldowns.set(id, Math.max(0, t - dt));
    }
  }

  reset(): void {
    this.cooldowns.clear();
  }
}
