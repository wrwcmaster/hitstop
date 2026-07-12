import {
  Actor,
  Registry,
  applyGravity,
  moveAndCollide,
  whiteOf,
  type CollisionSource,
} from '@engine/index';
import type { ActionGame } from '../defs';

/**
 * Data-driven monsters.
 *
 * A MonsterDef is plain data + three small callbacks (init/update/draw).
 * The Monster class supplies physics, health, hit-flash, death feedback
 * and registration — so a new enemy is ~20 lines of behavior, and that's
 * the whole point (see actors/enemies.ts for the built-ins).
 */
export interface MonsterDef {
  hp: number;
  /** Contact damage dealt to the player. */
  damage: number;
  w: number;
  h: number;
  score: number;
  /** Feedback + gib colors — also used for spawn telegraphs. */
  colors: string[];
  mass?: number;
  flies?: boolean;
  /** Loot rolled on death (each entry rolls independently). */
  drops?: { id: string; chance: number }[];
  /** One-time setup; stash per-instance state on the monster. */
  init?(m: Monster): void;
  /** Behavior. Physics (gravity + collide) runs after this. */
  update?(m: Monster, dt: number): void;
  /** Draw at m.x/m.y. Use m.img() for automatic hit-flash. */
  draw(g: CanvasRenderingContext2D, m: Monster): void;
}

export const monsters = new Registry<MonsterDef>('monster');

export function defineMonster(id: string, def: MonsterDef): void {
  monsters.register(id, def);
}

export class Monster extends Actor {
  def: MonsterDef;
  /** Free-form per-instance state for defs (hop timers, phases...). */
  state: Record<string, number | boolean> = {};

  constructor(
    public readonly type: string,
    public game: ActionGame,
    public collision: CollisionSource,
    x: number,
    y: number,
  ) {
    super();
    this.def = monsters.get(type);
    this.team = 'enemy';
    this.x = x;
    this.y = y;
    this.w = this.def.w;
    this.h = this.def.h;
    this.hp = this.maxHp = this.def.hp;
    this.mass = this.def.mass ?? 1;
    this.flies = this.def.flies ?? false;
    this.animT = Math.random() * 9;
    this.def.init?.(this);
  }

  /** Apply hit-flash to a frame. */
  img(frame: HTMLCanvasElement): HTMLCanvasElement {
    return this.flashT > 0 ? whiteOf(frame) : frame;
  }

  /** The player actor, if alive (AI targeting helper). */
  get player(): Actor | undefined {
    return this.world.actors('player')[0];
  }

  update(dt: number): void {
    this.tickTimers(dt);
    this.def.update?.(this, dt);
    applyGravity(this, dt);
    moveAndCollide(this, dt, this.collision, { ignoreOneWay: true });
  }

  render(g: CanvasRenderingContext2D): void {
    this.def.draw(g, this);
  }

  onDeath(): void {
    this.dead = true;
    // Kill feedback beyond the standard impact: gib burst in the
    // monster's colors + a brief white flash. Score is the scene's job
    // (it listens for 'kill' events).
    const feel = this.game.feel;
    feel.flash(0.18, '#ffffff');
    feel.sfx.play('kill');
    feel.burst(this.cx, this.cy, 16 + this.w, {
      color: this.def.colors,
      speed: 150,
      life: 0.55,
      grav: 320,
      drag: 1.5,
    });
  }

  onHurt(): void {
    this.game.feel.sfx.play('hit');
  }
}
