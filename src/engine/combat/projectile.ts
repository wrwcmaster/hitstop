import { Entity } from '../world/entity';
import type { Strike, StrikeOptions } from './combat';
import { Feel } from '../feel/feel';
import { CollisionSource } from '../physics/body';
import { Rect, overlaps, sweepEntry, union } from '../math/rect';

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
    const from = this.box;
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    // What this shot occupied THIS step is the path it swept, not the
    // point it stopped at. A body can be tested where it lands because a
    // body is bigger than its step — 14px wide, at most 7.7px of fall per
    // tick, so its footprints always overlap. A shot is the opposite: the
    // flintlock's 4px ball travels 10.7px a tick and leaves 6.7px between
    // consecutive footprints. Today the smallest wall is 8px and the
    // fastest shot is 640, so nothing quite slips through the gap — a
    // 1.3px margin nobody chose, protecting the rule that a bullet cannot
    // pass through stone. Sweeping states the rule instead of relying on
    // the numbers to stay lucky, and it costs one union per step.
    const swept = union(from, this.box);

    // Walls. Of everything the sweep crossed, the one it reached FIRST
    // is the one that stopped it — and the shot dies against that face,
    // not wherever the step happened to end. A bullet whose sparks burst
    // on the far side of the stone it hit is the same lie as a body
    // colliding at a position it never occupied.
    if (!this.opts.ghost) {
      const dx = this.x - (from.x + from.w / 2);
      const dy = this.y - (from.y + from.h / 2);
      let firstT: number | null = null;
      for (const s of this.collision.solidsNear(swept)) {
        if (s.oneWay || !overlaps(swept, s)) continue;
        const t = sweepEntry(from, dx, dy, s);
        if (t !== null && (firstT === null || t < firstT)) firstT = t;
      }
      if (firstT !== null) {
        this.x = from.x + from.w / 2 + dx * firstT;
        this.y = from.y + from.h / 2 + dy * firstT;
        this.feel.burst(this.x, this.y, 5, {
          color: '#94b0c2', speed: 60, life: 0.2, drag: 4,
        });
        return this.expire();
      }
    }
    // Gone: travelled clear of the level and cannot come back. Sideways
    // and downward are one-way exits; ABOVE is not, because an arrow's
    // arc leaves the room and returns, and expiring it there would
    // delete the shot mid-flight.
    const lvl = this.collision.bounds;
    if (lvl && (this.x < lvl.x - 20 || this.x > lvl.x + lvl.w + 20
      || this.y > lvl.y + lvl.h + 20)) return this.expire();

    // Targets — the strike brings the full feedback bundle with it. Same
    // swept region: a shot that crossed a body this step hit it, whether
    // or not it happened to stop inside.
    const hits = this.strike.apply(swept);
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
