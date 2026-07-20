import { Actor, Team } from '../world/entity';
import { Rect, overlaps, centerX, centerY } from '../math/rect';
import { Feel } from '../feel/feel';
import { EventBus } from '../core/events';
import { Projectile, ProjectileOptions } from './projectile';
import { CollisionSource } from '../physics/body';
import { formatAmount } from '../math/util';

/**
 * Combat resolution with feedback built in.
 *
 * The core loop is: an attack owns a Strike (an active hitbox + damage
 * payload); each update it calls `strike.apply(...)` against candidate
 * targets. Every connected hit automatically fires the tuned feel bundle
 * (hitstop, shake, kick, particles, damage number) scaled by the strike's
 * strength — combat feedback is not something callers remember to add,
 * it's what the engine does.
 *
 * Games listen on the combat event bus for scoring, drops, quests, AI...
 */
export interface HitInfo {
  attacker: Actor | null;
  target: Actor;
  damage: number;
  /** Horizontal direction of the hit: -1 or 1. */
  dir: number;
  /** 0..1 feel strength (see Feel.impact). */
  strength: number;
  killed: boolean;
}

export interface CombatEvents extends Record<string, unknown> {
  hit: HitInfo;
  kill: HitInfo;
}

export interface StrikeOptions {
  damage: number;
  /** Teams this strike can hit. */
  targets: Team;
  attacker?: Actor;
  /** Feel strength 0..1 (default 0.5). */
  strength?: number;
  /** Knockback speed in px/s (scaled by 1/target.mass). Default from strength. */
  knockback?: number;
  /** Vertical pop applied to grounded targets (px/s, negative = up). */
  popY?: number;
  /** Particle colors for impact feedback (defaults to white/gold). */
  colors?: string | string[];
  /** Ignore target invulnerability (environmental hazards usually don't). */
  pierceInvuln?: boolean;
}

/**
 * One attack's hit tracking: a strike hits each target at most once,
 * however long its hitbox stays active (multi-frame sword swings).
 */
export class Strike {
  private hitSet = new Set<Actor>();

  constructor(
    private combat: Combat,
    public opts: StrikeOptions,
  ) {}

  /** Aim this strike at a new team (parry/deflect), optionally sweetening
   * the damage, and forget who it has already hit so it can bite afresh. */
  retarget(team: Team, damageBonus = 0): void {
    this.opts = { ...this.opts, targets: team, damage: this.opts.damage + damageBonus };
    this.hitSet.clear();
  }

  /**
   * Test `box` against all live actors of the target team and apply hits.
   * Call every update while the attack is active. Returns actors hit
   * this update.
   */
  apply(box: Rect): Actor[] {
    const hits: Actor[] = [];
    for (const target of this.combat.world.actors(this.opts.targets)) {
      if (this.hitSet.has(target)) continue;
      if (!this.opts.pierceInvuln && target.invulnT > 0) continue;
      if (!overlaps(box, target.hurtbox)) continue;
      this.hitSet.add(target);
      this.combat.hit(target, this.opts, box);
      hits.push(target);
    }
    return hits;
  }
}

export class Combat {
  constructor(
    public world: import('../world/world').World,
    public feel: Feel,
    public events: EventBus<CombatEvents>,
  ) {}

  /** Begin an attack. Keep the Strike for the attack's active frames. */
  strike(opts: StrikeOptions): Strike {
    return new Strike(this, opts);
  }

  /** Fire a projectile: a moving hitbox carrying a strike. */
  shoot(opts: ProjectileOptions, collision: CollisionSource): Projectile {
    return this.world.spawn(new Projectile(opts, this.feel, collision, (o) => this.strike(o)));
  }

  /**
   * Apply one hit to a target: damage, hit-flash, knockback, i-frames on
   * kill-less hits are the target's business (set in onHurt), plus the
   * full feedback bundle. Also usable directly for contact damage.
   */
  hit(target: Actor, opts: StrikeOptions, from?: Rect): void {
    // Parry: a raised guard deflects the blow entirely. The target owns
    // the reaction (spark, sound, staggering the attacker) — no damage,
    // knockback, or i-frame bookkeeping happens here. Environmental
    // hazards (pierceInvuln) blow through a guard.
    if (target.parrying && !opts.pierceInvuln) {
      target.onParried(opts, this);
      return;
    }
    const s = opts.strength ?? 0.5;
    const source = from ?? opts.attacker ?? target;
    const dir = centerX(target.hurtbox) >= centerX(source as Rect) ? 1 : -1;

    target.hp -= opts.damage;
    target.flashT = 0.12;

    const kb = (opts.knockback ?? 90 + s * 160) / target.mass;
    target.vx += dir * kb;
    if (!target.flies) target.vy = (opts.popY ?? -70) / target.mass;

    const killed = target.hp <= 0;
    const info: HitInfo = {
      attacker: opts.attacker ?? null,
      target,
      damage: opts.damage,
      dir,
      strength: s,
      killed,
    };

    // Feedback bundle — the reason this engine exists.
    const hx = (centerX(source as Rect) + centerX(target.hurtbox)) / 2 + dir * 4;
    const hy = centerY(target.hurtbox);
    this.feel.impact(hx, hy, {
      strength: killed ? Math.max(s, 0.9) : s,
      dir,
      colors: opts.colors,
    });
    // Zero-damage hits (slows, knockback-only pushes) skip the number.
    // Fractional damage (a graze, a DoT tick) shows one decimal so it
    // reads as "not quite a full hit" rather than getting rounded away.
    if (opts.damage > 0) {
      this.feel.text(centerX(target.hurtbox), target.hurtbox.y - 4, formatAmount(opts.damage), s > 0.6 ? '#ffcd75' : '#f4f4f4', s > 0.6 ? 2 : 1);
    }

    target.onHurt(info);
    this.events.emit('hit', info);
    if (killed) {
      target.onDeath(info);
      this.events.emit('kill', info);
    }
  }
}
