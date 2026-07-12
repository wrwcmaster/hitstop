import {
  Actor,
  FSM,
  Buffer,
  Strike,
  applyGravity,
  moveAndCollide,
  frameAt,
  whiteOf,
  friction,
  clamp,
  overlaps,
  chance,
  type StateDef,
  type CollisionSource,
  type Rect,
} from '@engine/index';
import {
  Stats,
  Inventory,
  Equipment,
  SkillBook,
} from '@engine/index';
import { KNIGHT_ANIMS } from '../content/sprites';
import { COLORS } from '../content/palette';
import { weaponSpecOf, type WeaponSpec } from '../content/items';
import type { SkillCtx } from '../content/skills';
import { Monster } from './monster';
import type { ActionGame } from '../defs';

/** Movement + combat tuning in one place. Tweak freely. */
export const PLAYER_TUNING = {
  runSpeed: 110,
  runAccel: 1400,
  groundFriction: 0.0001,
  airFriction: 0.1,
  jumpSpeed: 350,
  jumpCutSpeed: 130, // vy clamp when jump is released early
  coyoteTime: 0.1,
  jumpBufferTime: 0.12,
  attackBufferTime: 0.16,
  dashSpeed: 300,
  dashTime: 0.16,
  dashCooldown: 0.45,
  dashInvuln: 0.2,
  comboWindow: 0.28,
  hurtInvuln: 1.1,
  maxHp: 5,
  maxMp: 3,
};

/**
 * The player knight: an FSM over move/attack/dash/dead, with the classic
 * feel kit — coyote time, jump buffering, jump cut, attack buffering,
 * squash & stretch, dash i-frames, 3-hit combo with a heavy finisher.
 */
export class Player extends Actor {
  team = 'player' as const;
  w = 9;
  h = 13;
  hp = PLAYER_TUNING.maxHp;
  maxHp = PLAYER_TUNING.maxHp;

  /** Base stats; equipment projects modifiers in via `equipment`. */
  stats = new Stats({ maxHp: PLAYER_TUNING.maxHp, maxMp: PLAYER_TUNING.maxMp, attack: 0 });
  inventory = new Inventory();
  equipment = new Equipment(this.stats);
  skills = new SkillBook<SkillCtx>({
    canAfford: (cost) => this.mp >= cost,
    spend: (cost) => {
      this.mp -= cost;
    },
  });
  mp = PLAYER_TUNING.maxMp;

  get maxMp(): number {
    return Math.round(this.stats.get('maxMp'));
  }

  private jumpBuf = new Buffer(PLAYER_TUNING.jumpBufferTime);
  private atkBuf = new Buffer(PLAYER_TUNING.attackBufferTime);
  private coyote = new Buffer(PLAYER_TUNING.coyoteTime);
  private comboWin = new Buffer(PLAYER_TUNING.comboWindow);

  /** Vertical squash factor for landing/jumping (1 = normal). */
  squash = 1;
  private wasGround = false;
  private dashCd = 0;
  private attackIndex = 0;
  private attackDur = 0;
  private strike: Strike | null = null;
  deadT = 0;

  fsm: FSM<Player>;

  constructor(
    public game: ActionGame,
    public collision: CollisionSource,
    x: number,
    y: number,
  ) {
    super();
    this.x = x;
    this.y = y;
    this.layer = 10;
    // Starting kit: a weapon in hand, a potion in the bag, one spell known.
    this.inventory.add('rusty-sword');
    this.equipment.equip('rusty-sword');
    this.inventory.add('potion');
    this.skills.learn('fireball');
    this.syncStats();
    this.hp = this.maxHp;
    this.mp = this.maxMp;
    this.fsm = new FSM<Player>(this, PLAYER_STATES, 'move');
  }

  /** Pull derived values from stats (call after equipment changes). */
  syncStats(): void {
    this.maxHp = Math.round(this.stats.get('maxHp'));
    this.hp = Math.min(this.hp, this.maxHp);
    this.mp = Math.min(this.mp, this.maxMp);
  }

  heal(n: number): void {
    this.hp = Math.min(this.maxHp, this.hp + n);
  }

  restoreMp(n: number): void {
    this.mp = Math.min(this.maxMp, this.mp + n);
  }

  /** The attack spec of whatever's in the weapon slot (fists if empty). */
  get weapon(): WeaponSpec {
    return weaponSpecOf(this.equipment.get('weapon'));
  }

  get input() {
    return this.game.input;
  }

  get feel() {
    return this.game.feel;
  }

  /* ---------------- states ---------------- */

  moveUpdate(dt: number): string | void {
    this.runControls(dt);
    if (this.atkBuf.consume()) return 'attack';
    if (this.input.consumePress('dash') && this.dashCd <= 0) return 'dash';
    if (this.input.consumePress('skill')) {
      this.skills.cast('fireball', { game: this.game, player: this });
    }
  }

  beginAttack(): void {
    const w = this.weapon;
    this.attackIndex = this.comboWin.consume() ? (this.attackIndex + 1) % 3 : 0;
    const heavy = this.attackIndex === 2;
    this.attackDur = heavy ? 0.3 : 0.2;
    this.vx += this.facing * (heavy ? 150 : 45);
    // Damage/feel come from the equipped weapon; flat bonus from stats.
    this.strike = this.game.combat.strike({
      damage: (heavy ? w.heavyDamage : w.lightDamage) + Math.round(this.stats.get('attack')),
      targets: 'enemy',
      attacker: this,
      strength: heavy ? w.heavyStrength : w.lightStrength,
      colors: w.colors,
    });
    this.feel.sfx.play('slash');
  }

  attackUpdate(dt: number): string | void {
    this.vx *= friction(0.002, dt);
    const prog = this.fsm.t / this.attackDur;
    // Active frames: 10%..60% of the swing.
    if (prog > 0.1 && prog < 0.6) this.strike?.apply(this.attackBox());
    if (prog >= 1) {
      this.comboWin.set(); // chain window for the next combo hit
      return 'move';
    }
  }

  beginDash(): void {
    const T = PLAYER_TUNING;
    this.dashCd = T.dashCooldown;
    this.invulnT = Math.max(this.invulnT, T.dashInvuln);
    this.squash = 0.6;
    this.feel.sfx.play('dash');
    this.feel.burst(this.cx, this.y + this.h - 2, 6, {
      color: [COLORS.steel, COLORS.white], speed: 50, life: 0.3, drag: 4,
    });
  }

  dashUpdate(): string | void {
    this.vx = this.facing * PLAYER_TUNING.dashSpeed;
    this.vy = 0;
    if (Math.floor(this.fsm.t * 60) % 2 === 0) {
      this.feel.particles.spawn({
        x: this.cx - this.facing * 4, y: this.y + this.h - 2,
        vx: -this.facing * 20, vy: -10, life: 0.3, size: 3,
        color: COLORS.steel, drag: 4,
      });
    }
    if (this.fsm.t >= PLAYER_TUNING.dashTime) {
      this.vx = this.facing * PLAYER_TUNING.runSpeed;
      return 'move';
    }
  }

  /* ---------------- combat ---------------- */

  /** Active attack hitbox in world space (only valid during attack state). */
  attackBox(): Rect {
    const heavy = this.attackIndex === 2;
    const reach = this.weapon.reach;
    const w = (heavy ? 26 : 20) + reach;
    const h = (heavy ? 20 : 16) + Math.max(0, reach / 2);
    return {
      x: this.facing === 1 ? this.x + this.w - 2 : this.x - w + 2,
      y: this.y + this.h / 2 - h / 2,
      w,
      h,
    };
  }

  hurt(source: Monster): void {
    const T = PLAYER_TUNING;
    this.hp -= source.def.damage;
    this.invulnT = T.hurtInvuln;
    this.flashT = 0.15;
    const dir = this.cx < source.cx ? -1 : 1;
    this.vx = dir * 170;
    this.vy = -160;
    this.feel.sfx.play('hurt');
    this.feel.shake(0.5);
    this.feel.kick(dir * 4, -2);
    this.feel.hitstop(0.09);
    this.feel.flash(0.35, COLORS.red);
    this.feel.burst(this.cx, this.cy, 10, {
      color: [COLORS.red, COLORS.white],
      speed: 110, life: 0.4, grav: 300, drag: 2,
    });
    this.game.events.emit('playerHurt', { hp: this.hp });
    if (this.hp <= 0) this.die();
    else this.fsm.set('move');
  }

  private die(): void {
    this.invulnT = 99;
    this.vy = -220;
    this.feel.slowmo(0.9);
    this.feel.shake(1);
    this.feel.flash(0.6, COLORS.red);
    this.feel.sfx.play('kill');
    this.feel.burst(this.cx, this.cy, 26, {
      color: [COLORS.steel, COLORS.red, COLORS.white],
      speed: 170, life: 0.7, grav: 250, drag: 1,
    });
    this.fsm.set('dead');
    this.game.events.emit('playerDied', {});
  }

  /* ---------------- update ---------------- */

  update(dt: number): void {
    const T = PLAYER_TUNING;
    this.tickTimers(dt);
    this.jumpBuf.update(dt);
    this.atkBuf.update(dt);
    this.coyote.update(dt);
    this.comboWin.update(dt);
    this.dashCd = Math.max(0, this.dashCd - dt);
    this.skills.update(dt);
    this.squash += (1 - this.squash) * Math.min(1, dt * 10);

    if (this.input.pressed('jump')) this.jumpBuf.set();
    if (this.input.pressed('attack')) this.atkBuf.set();

    this.fsm.update(dt);

    // Gravity + jump physics (dash overrides velocity; the dead still fall).
    if (!this.fsm.is('dash')) {
      applyGravity(this, dt);
      if (this.jumpBuf.active && this.coyote.active && !this.fsm.is('dead', 'attack')) {
        this.jumpBuf.consume();
        this.coyote.consume();
        this.vy = -T.jumpSpeed;
        this.squash = 1.35;
        this.feel.sfx.play('jump');
        this.feel.burst(this.cx, this.y + this.h, 5, {
          color: COLORS.navyLight, speed: 40, life: 0.25,
          angle: Math.PI / 2, spread: 1.5, drag: 3,
        });
      }
      // Variable jump height: releasing jump early cuts the ascent.
      if (!this.fsm.is('dead') && !this.input.held('jump') && this.vy < -T.jumpCutSpeed) {
        this.vy = -T.jumpCutSpeed;
      }
    }
    const fallSpeed = this.vy;
    moveAndCollide(this, dt, this.collision);

    if (this.onGround) {
      this.coyote.set();
      if (!this.wasGround && fallSpeed > 240) {
        // Landing feedback scales with impact speed.
        this.squash = 0.6;
        this.feel.sfx.play('land');
        this.feel.burst(this.cx, this.y + this.h, 7, {
          color: COLORS.navyLight, speed: 55, life: 0.3,
          angle: -Math.PI / 2, spread: 2.6, drag: 4,
        });
        if (fallSpeed > 420) this.feel.shake(0.15);
      }
    }
    this.wasGround = this.onGround;

    // Contact damage (dashing passes through; i-frames blink through).
    if (!this.fsm.is('dead', 'dash') && this.invulnT <= 0) {
      for (const e of this.world.actors('enemy')) {
        if (e instanceof Monster && overlaps(this, e.hurtbox)) {
          this.hurt(e);
          break;
        }
      }
    }
  }

  /** Ground/air movement control shared by the move state. */
  private runControls(dt: number): void {
    const T = PLAYER_TUNING;
    const dir = this.input.axis('left', 'right');
    if (dir !== 0) {
      this.facing = dir as 1 | -1;
      this.vx = clamp(this.vx + dir * T.runAccel * dt, -T.runSpeed, T.runSpeed);
      if (this.onGround && chance(dt * 8)) {
        this.feel.particles.spawn({
          x: this.cx - this.facing * 3, y: this.y + this.h - 1,
          vx: -this.facing * 15, vy: -15, life: 0.25, size: 2,
          color: COLORS.navyLight, drag: 3,
        });
      }
    } else {
      this.vx *= friction(this.onGround ? T.groundFriction : T.airFriction, dt);
    }
  }

  /* ---------------- render ---------------- */

  render(g: CanvasRenderingContext2D): void {
    // I-frame blink.
    if (this.invulnT > 0 && !this.fsm.is('dead') && Math.floor(this.invulnT * 20) % 2) return;

    let anim = 'air';
    if (this.onGround) anim = Math.abs(this.vx) > 8 ? 'run' : 'idle';
    const set = this.facing === 1 ? KNIGHT_ANIMS.right : KNIGHT_ANIMS.left;
    let img = frameAt(set, anim, this.animT);
    if (this.flashT > 0) img = whiteOf(img);

    const cx = this.cx;
    const by = this.y + this.h;

    if (this.fsm.is('dead')) {
      // Keel over and fade.
      g.save();
      g.translate(Math.round(cx), Math.round(by - 4));
      g.rotate(this.facing * (Math.PI / 2) * Math.min(1, this.deadT * 3));
      g.globalAlpha = Math.max(0, 1 - Math.max(0, this.deadT - 0.8));
      g.drawImage(img, -6, -9);
      g.restore();
      g.globalAlpha = 1;
      return;
    }

    // Squash & stretch anchored at the feet.
    const sy = this.squash;
    const sx = 1 + (1 - sy) * 0.7;
    g.save();
    g.translate(Math.round(cx), Math.round(by));
    g.scale(sx, sy);
    g.drawImage(img, -6, -14);
    g.restore();

    if (this.fsm.is('attack')) this.renderSlash(g, cx, this.y + this.h * 0.55);
  }

  /** Sword arc: a sweeping stroke with a bright leading tip. */
  private renderSlash(g: CanvasRenderingContext2D, cx: number, my: number): void {
    const prog = Math.min(1, this.fsm.t / this.attackDur);
    const heavy = this.attackIndex === 2;
    const r = (heavy ? 17 : 13) + Math.max(0, Math.round(this.weapon.reach / 2));
    const flipV = this.attackIndex === 1 ? -1 : 1;
    const sweep = (-1.3 + 2.6 * Math.min(1, prog * 1.7)) * flipV;
    const a = this.facing === 1 ? sweep : Math.PI - sweep;
    const a0 = this.facing === 1 ? -1.3 * flipV : Math.PI + 1.3 * flipV;
    g.strokeStyle = prog < 0.45 ? COLORS.white : COLORS.steel;
    g.lineWidth = heavy ? 3 : 2;
    g.beginPath();
    g.arc(cx, my, r, Math.min(a0, a), Math.max(a0, a));
    g.stroke();
    if (heavy) {
      g.strokeStyle = COLORS.gold;
      g.lineWidth = 1;
      g.beginPath();
      g.arc(cx, my, r + 3, Math.min(a0, a), Math.max(a0, a));
      g.stroke();
    }
    g.fillStyle = COLORS.white;
    g.fillRect(Math.round(cx + Math.cos(a) * r) - 1, Math.round(my + Math.sin(a) * r) - 1, 3, 3);
  }
}

const PLAYER_STATES: Record<string, StateDef<Player>> = {
  move: {
    update: (p, dt) => p.moveUpdate(dt),
  },
  attack: {
    enter: (p) => p.beginAttack(),
    update: (p, dt) => p.attackUpdate(dt),
  },
  dash: {
    enter: (p) => p.beginDash(),
    update: (p) => p.dashUpdate(),
  },
  dead: {
    update: (p, dt) => {
      p.deadT += dt;
    },
  },
};
