import { Entity } from '../world/entity';
import type { Strike, StrikeOptions } from './combat';
import { Feel } from '../feel/feel';
import { CollisionSource } from '../physics/body';
import { Rect } from '../math/rect';

/**
 * Projectiles: bullets, arrows, magic bolts, thrown rocks.
 *
 * A projectile is a moving hitbox carrying a Strike — so on contact it
 * produces the exact same tuned feedback bundle as a sword swing. Walls
 * stop it (unless ghost), pierce lets it survive N hits, and the draw
 * callback keeps visuals fully in content's hands.
 */
export interface ProjectileOptions {
  x: number;
  y: number;
  vx: number;
  vy: number;
  w?: number;
  h?: number;
  /** Seconds before it fizzles (default 2). */
  life?: number;
  /** Gravity in px/s² (0 = straight shot). */
  gravity?: number;
  /** How many targets it can hit before dying (default 1; Infinity = beam). */
  pierce?: number;
  /** Pass through solid tiles. */
  ghost?: boolean;
  /** Damage payload — same options as any melee strike. */
  strike: StrikeOptions;
  /** Visuals. Trail/glow effects belong here too. */
  draw(g: CanvasRenderingContext2D, p: Projectile): void;
  /** Called per target hit — apply statuses, spawn children, etc. */
  onHit?(target: import('../world/entity').Actor, p: Projectile): void;
  /** Called once when the projectile dies (wall, timeout, or final hit). */
  onExpire?(p: Projectile): void;
}

export class Projectile extends Entity {
  x: number;
  y: number;
  vx: number;
  vy: number;
  w: number;
  h: number;
  life: number;
  /** Age in seconds — drive animation/trails from this. */
  t = 0;
  facing: 1 | -1;

  private pierceLeft: number;
  private strike: Strike;

  constructor(
    private opts: ProjectileOptions,
    private feel: Feel,
    private collision: CollisionSource,
    makeStrike: (o: StrikeOptions) => Strike,
  ) {
    super();
    this.x = opts.x;
    this.y = opts.y;
    this.vx = opts.vx;
    this.vy = opts.vy;
    this.w = opts.w ?? 4;
    this.h = opts.h ?? 4;
    this.life = opts.life ?? 2;
    this.pierceLeft = opts.pierce ?? 1;
    this.facing = opts.vx >= 0 ? 1 : -1;
    this.strike = makeStrike(opts.strike);
    this.layer = 5;
  }

  get box(): Rect {
    return { x: this.x - this.w / 2, y: this.y - this.h / 2, w: this.w, h: this.h };
  }

  /** The team this shot currently threatens. */
  get targetTeam(): import('../world/entity').Team {
    return this.strike.opts.targets;
  }

  /**
   * Send this shot flying the other way, now dangerous to the opposite
   * team (a parry/deflect). New velocity, refreshed life, and the strike
   * forgets prior hits so it can strike its former owners.
   */
  reflect(vx: number, vy: number, damageBonus = 0): void {
    const foe = this.strike.opts.targets === 'player' ? 'enemy' : 'player';
    this.vx = vx;
    this.vy = vy;
    this.facing = vx >= 0 ? 1 : -1;
    this.strike.retarget(foe, damageBonus);
    this.life = Math.max(this.life, 1.4);
    this.pierceLeft = Math.max(this.pierceLeft, 1);
  }

  private expire(): void {
    if (this.dead) return;
    this.dead = true;
    this.opts.onExpire?.(this);
  }

  update(dt: number): void {
    this.t += dt;
    this.life -= dt;
    if (this.life <= 0) return this.expire();

    this.vy += (this.opts.gravity ?? 0) * dt;
    this.x += this.vx * dt;
    this.y += this.vy * dt;

    // Walls.
    if (!this.opts.ghost) {
      for (const s of this.collision.solidsNear(this.box)) {
        if (s.oneWay) continue;
        const b = this.box;
        if (b.x < s.x + s.w && b.x + b.w > s.x && b.y < s.y + s.h && b.y + b.h > s.y) {
          this.feel.burst(this.x, this.y, 5, {
            color: '#94b0c2', speed: 60, life: 0.2, drag: 4,
          });
          return this.expire();
        }
      }
    }
    // Gone: travelled clear of the level (a margin past its edge).
    const lvl = this.collision.bounds;
    if (lvl && (this.x < lvl.x - 20 || this.x > lvl.x + lvl.w + 20)) return this.expire();

    // Targets — the strike brings the full feedback bundle with it.
    const hits = this.strike.apply(this.box);
    if (hits.length) {
      if (this.opts.onHit) for (const t of hits) this.opts.onHit(t, this);
      this.pierceLeft -= hits.length;
      if (this.pierceLeft <= 0) return this.expire();
    }
  }

  render(g: CanvasRenderingContext2D): void {
    this.opts.draw(g, this);
  }
}
