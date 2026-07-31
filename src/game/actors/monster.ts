import {
  Actor,
  Registry,
  Statuses,
  applyGravity,
  moveAndCollide,
  placeBody,
  whiteOf,
  rand,
  type CollisionSource,
  type StrikeOptions,
} from '@engine/index';
import type { ActorHost } from '../defs';
import { nearestPlayer, type Player } from './player';

export interface SwallowDef {
  status?: string;
  escapeNeed?: number;
  message?: string;
  colors?: string[];
  onEnter?(m: Monster, player: Player): void;
  onRelease?(m: Monster, player: Player, burst: boolean): void;
  /** Draw inside the player's transformed body coordinates. */
  drawPlayerOverlay?(g: CanvasRenderingContext2D, m: Monster, player: Player, w: number, h: number): void;
}

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
  /** Validate per-room instance props before spawning. */
  validateProps?(props: Record<string, unknown>, path: string): void;
  mass?: number;
  flies?: boolean;
  /** Loot rolled on death (each entry rolls independently). */
  drops?: { id: string; chance: number }[];
  /** Bosses get an HP bar and a bigger death. */
  boss?: boolean;
  /** Shown on the boss HP bar. */
  displayName?: string;
  /** Conversation played after this boss falls (default 'victory'). */
  epilogue?: string;
  /**
   * Permanent unlock this boss hands over when it dies (an earnable id
   * from content/earnables.ts). What it *is* — a traversal verb, a key
   * item, an off-tree skill — is the catalog's business, not this one's.
   *
   * Declaring the reward on the boss is what keeps `PlayScene` free of a
   * boss-id switch: a fifth reward is this one line plus a catalog entry.
   * Granting is idempotent, so a re-killed boss gives nothing twice.
   */
  grants?: string;
  /** Touching this monster doesn't hurt (it attacks some other way). */
  noContactDamage?: boolean;
  /**
   * How far away this one can still hurt you, in px, when it hurts you
   * without touching. Authored rather than inferred: nothing about a
   * behaviour tells an observer that it shoots, and "far away" means
   * something completely different for an archer than for a slime.
   * Absent = it must reach you to matter.
   */
  rangedAt?: number;
  /**
   * Killing this one is a change to the room, not an encounter: it stays
   * dead across room transitions and saves. For scenery that pays out
   * once (a chest, a barrel, a cracked pillar) — without it, walking out
   * and back in refills the loot. Bosses use their own `slain:` flags,
   * which also gate music and epilogues.
   */
  persistent?: boolean;
  /**
   * Shrink the CONTACT damage box by this many px per side (round
   * sprites whose AABB corners are empty). The hurtbox the player's
   * attacks test against stays full size — forgiving both ways.
   */
  contactInset?: number;
  /** Definition-owned unusual contact. Return true to suppress normal damage. */
  onPlayerContact?(m: Monster, player: Player): boolean | void;
  /**
   * Transform an incoming blow before it lands (see Entity.mitigate).
   * A def-level hook because "how much this creature feels a hit" is
   * content: Mourn is braced on the side its ear is pinned to and open
   * on the other, which is its entire damage model.
   */
  mitigate?(m: Monster, damage: number, opts: StrikeOptions): number;
  /** Strategy for holding and presenting a swallowed player. */
  swallow?: SwallowDef;
  /** XP granted on kill (default: score / 20). */
  xp?: number;
  /**
   * Presentation state a co-op guest needs in order to READ this monster,
   * as a few plain numbers (rides `MobSnap.tell`). Only for tells that
   * live in internal state rather than in position and facing — a boss
   * whose safe-opening signal is an internal value is unreadable on a
   * guest's screen without this. Omit it and nothing is sent.
   */
  tell?(m: Monster): number[];
  /** Apply a `tell` on the guest's puppet, which is never simulated. */
  readTell?(m: Monster, tell: number[]): void;
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
  /** Free-form per-instance state for defs (hop timers, phases, FSMs...). */
  state: Record<string, unknown> = {};
  /** Elemental debuffs (burning, frozen...) — same system as the player. */
  statuses = new Statuses(this);
  /**
   * Which of the room's placed entities this instance came from (see
   * `entityKey`), or `''` for one spawned by a wave, a scenario, or the
   * test spawner. Only a monster the ROOM placed can be permanently
   * removed from it — nothing else has a slot in the room to empty.
   */
  origin = '';
  /**
   * Per-instance overrides the ROOM wrote for this one (`RoomEntity.props`),
   * readable from `init`/`update`. `MonsterDef.validateProps` is what
   * guards their shape at load, so a def that declares props gets them
   * checked in the editor and delivered here — the two halves of the
   * same bargain. Empty for wave, scenario, and cheat spawns.
   */
  props: Record<string, unknown> = {};

  /**
   * Presentation law: a shiver is drawn, not simulated. Defs write these
   * every frame they want the body to tremble (cleared each update);
   * render applies them as a translate. They never touch x/y, so a
   * windup tell can no longer walk a body into a wall 0.6px at a time.
   */
  tremorX = 0;
  tremorY = 0;

  constructor(
    public readonly type: string,
    public game: ActorHost,
    public collision: CollisionSource,
    x: number,
    y: number,
    /** Room overrides for this instance; `init` reads them (see `props`). */
    props?: Record<string, unknown>,
  ) {
    super();
    this.def = monsters.get(type);
    this.team = 'enemy';
    // Before init: a def that takes placement props needs them to exist
    // by the time it is deciding what this instance IS.
    if (props) this.props = props;
    this.w = this.def.w;
    this.h = this.def.h;
    // Placement law: a spawn authored a few pixels into the floor is
    // resolved the way the mover would have left it, never born buried
    // where collision cannot see it. (Size must be known first, which is
    // why placement follows the def lookup.)
    //
    // And when there is genuinely nowhere to stand, it does not exist.
    // Ignoring this verdict is how Mourn's keen put an echo bat inside
    // the arena's east wall: a blind ±26px offset landed in three
    // columns of stone, placement said "no" and the caller spawned it
    // anyway. A monster in a wall is worse than a monster that never
    // arrived — it cannot be fought, and collision cannot see it.
    if (!placeBody(this, x, y, collision)) this.dead = true;
    this.hp = this.maxHp = this.def.hp;
    this.mass = this.def.mass ?? 1;
    this.flies = this.def.flies ?? false;
    // Gameplay stream, not Math.random: spawned during the sim, and some
    // def logic could key off animT — keep it inside the replayable world.
    this.animT = rand(0, 9);
    this.def.init?.(this);
  }

  /** Apply hit-flash to a frame. */
  img(frame: HTMLCanvasElement): HTMLCanvasElement {
    return this.flashT > 0 ? whiteOf(frame) : frame;
  }

  /** The nearest living player (AI targeting helper — co-op aware). */
  get player(): Actor | undefined {
    return nearestPlayer(this.world, this.cx, this.cy) ?? undefined;
  }

  /** Defs decide how a blow lands on them; by default it lands whole. */
  mitigate(damage: number, opts: StrikeOptions): number {
    return this.def.mitigate ? this.def.mitigate(this, damage, opts) : damage;
  }

  update(dt: number): void {
    this.tickTimers(dt);
    this.tremorX = 0;
    this.tremorY = 0;
    this.statuses.update(dt);
    // A halting status (frozen, stunned) stops the brain but not physics —
    // a frozen bat still falls out of the sky. A parry-stagger (hitstun)
    // likewise suspends the AI while knockback carries and bleeds off.
    if (this.hitstun > 0) {
      this.vx *= Math.pow(0.02, dt);
    } else if (this.statuses.halted) {
      this.vx = 0;
    } else {
      this.def.update?.(this, dt);
    }
    applyGravity(this, dt);
    moveAndCollide(this, dt, this.collision, { ignoreOneWay: true });
  }

  render(g: CanvasRenderingContext2D): void {
    const trembling = this.tremorX !== 0 || this.tremorY !== 0;
    if (trembling) {
      g.save();
      g.translate(this.tremorX, this.tremorY);
    }
    this.def.draw(g, this);
    if (trembling) g.restore();
    // Encasing veil (ice, amber): a translucent block over the body.
    for (const s of this.statuses.list()) {
      if (!s.def.veil) continue;
      g.save();
      g.globalAlpha = 0.4;
      g.fillStyle = s.def.veil;
      g.fillRect(Math.round(this.x - 1), Math.round(this.y - 1), this.w + 2, this.h + 2);
      g.restore();
    }
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
    if (this.def.boss) {
      // A boss death is an event: slow the world down and paint it.
      feel.slowmo(1.2, 0.25);
      feel.shake(1);
      feel.flash(0.5, '#ffffff');
      feel.burst(this.cx, this.cy, 60, {
        color: this.def.colors, speed: 240, life: 1.0, grav: 260, drag: 1.2,
      });
    }
  }

  onHurt(): void {
    this.game.feel.sfx.play('hit');
  }
}
