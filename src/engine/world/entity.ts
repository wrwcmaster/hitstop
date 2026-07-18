import { Body } from '../physics/body';
import { Rect } from '../math/rect';

/**
 * Entity model.
 *
 * hitstop deliberately uses classic entities (objects with update/render)
 * rather than a full ECS: at this scale, straight-line readable code beats
 * archetype tables, and content is data-driven at the *definition* level
 * (actor defs in registries) rather than the component level. The World
 * still supports cross-cutting "systems" for logic that spans entities.
 */
export abstract class Entity {
  /** Set by World on spawn. */
  world!: import('./world').World;
  /** Marked for removal at the end of the current update. */
  dead = false;
  /** Draw order: lower renders first. */
  layer = 0;

  update(_dt: number): void {}
  render(_g: CanvasRenderingContext2D): void {}
  /** Called when removed from the world. */
  onRemove(): void {}
}

export type Team = 'player' | 'enemy' | 'neutral';

/**
 * A physical, damageable, animated entity — players, monsters, bosses.
 * Implements Body so it plugs straight into the physics module.
 */
export abstract class Actor extends Entity implements Body, Rect {
  x = 0;
  y = 0;
  w = 8;
  h = 8;
  vx = 0;
  vy = 0;
  onGround = false;
  flies = false;
  /** Heavier actors take less knockback. */
  mass = 1;

  team: Team = 'neutral';
  hp = 1;
  maxHp = 1;
  /** Seconds of remaining hit-flash (render sprite white while > 0). */
  flashT = 0;
  /** Seconds of remaining invulnerability. */
  invulnT = 0;
  /** Seconds of remaining stagger: AI is suspended while > 0 (parry, etc.). */
  hitstun = 0;
  /** When true, incoming hits are deflected (see Combat.hit + onParried). */
  parrying = false;
  /** Facing: 1 = right, -1 = left. */
  facing: 1 | -1 = 1;
  /** Animation clock; advance in update, use with gfx/animation. */
  animT = 0;

  get cx(): number {
    return this.x + this.w / 2;
  }

  get cy(): number {
    return this.y + this.h / 2;
  }

  /** The rectangle that can be hit. Defaults to the body; override to shrink. */
  get hurtbox(): Rect {
    return this;
  }

  /** Tick shared timers. Call from subclasses' update. */
  protected tickTimers(dt: number): void {
    this.animT += dt;
    this.flashT = Math.max(0, this.flashT - dt);
    this.invulnT = Math.max(0, this.invulnT - dt);
    this.hitstun = Math.max(0, this.hitstun - dt);
  }

  /** Hook: called by Combat when this actor takes a hit (after hp change). */
  onHurt(_hit: import('../combat/combat').HitInfo): void {}

  /** Hook: called by Combat instead of a hit when `parrying` deflected it.
   * The target owns the reaction (feedback, staggering the attacker). */
  onParried(_opts: import('../combat/combat').StrikeOptions, _combat: import('../combat/combat').Combat): void {}
  /** Hook: called by Combat when hp reaches 0. Default: mark dead. */
  onDeath(_hit: import('../combat/combat').HitInfo): void {
    this.dead = true;
  }
}
