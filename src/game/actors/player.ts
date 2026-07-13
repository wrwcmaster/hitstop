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
  expand,
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
  Statuses,
  Progression,
  SkillTree,
} from '@engine/index';
import type { TreeCtx } from '../content/skilltree';
import { KNIGHT_ANIMS, TEXEL } from '../content/sprites';
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
  // 400 px/s ≈ 53px of rise (v²/2g): enough to reach the 48-50px arena
  // platforms with a little margin. (At the POC's 350 they were 41px —
  // decoratively unreachable.)
  jumpSpeed: 400,
  jumpCutSpeed: 130, // vy clamp when jump is released early
  doubleJumpSpeed: 370, // SKY DANCER's air jump
  coyoteTime: 0.1,
  jumpBufferTime: 0.12,
  attackBufferTime: 0.16,
  dashSpeed: 300,
  dashTime: 0.16,
  dashCooldown: 0.45,
  dashInvuln: 0.2,
  attackLunge: 45,
  heavyAttackLunge: 150,
  comboWindow: 0.28,
  castTime: 0.2, // brief commit while a spell leaves the hand
  castRecoil: 40, // backward brace when a spell fires
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

  /** Base stats; equipment and statuses project modifiers in. */
  stats = new Stats({
    maxHp: PLAYER_TUNING.maxHp,
    maxMp: PLAYER_TUNING.maxMp,
    attack: 0,
    speed: PLAYER_TUNING.runSpeed,
  });
  inventory = new Inventory();
  equipment = new Equipment(this.stats);
  statuses = new Statuses(this);
  gold = 0;

  /** XP curve: 40 XP for level 1→2, +25 per level after. */
  progression = new Progression(
    (level) => 40 + (level - 1) * 25,
    1,
    (level) => this.onLevelUp(level),
  );
  tree = new SkillTree<TreeCtx>({ stats: this.stats, syncStats: () => this.syncStats() });
  skills = new SkillBook<SkillCtx>(
    {
      canAfford: (cost) => this.mp >= cost,
      spend: (cost) => {
        this.mp -= cost;
      },
    },
    // ARCANE FLOW (skill tree): halved cooldowns.
    () => (this.tree.has('m2') ? 0.5 : 1),
  );
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
  /** Active spell + its animation window (the `cast` state). */
  private pendingSkill: string | null = null;
  private castDur = 0;
  deadT = 0;

  /** Swallowed-by-a-Devourer state. */
  swallowedBy: Monster | null = null;
  escapeN = 0;
  escapeNeed = 7;

  /** Air jumps left (SKY DANCER grants 1; refreshed on landing). */
  private airJumps = 0;
  /** DASH STRIKE (skill tree): the active dash's damage payload. */
  private dashStrike: Strike | null = null;

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

  /** Award XP with a floater; level-ups fire onLevelUp. */
  gainXp(n: number): void {
    if (n <= 0 || this.hp <= 0) return;
    this.feel.text(this.cx, this.y - 14, `+${n} XP`, COLORS.steel);
    this.progression.addXp(n);
  }

  /** The ding: full restore + fanfare. New points nudge you to the tree. */
  private onLevelUp(level: number): void {
    this.hp = this.maxHp;
    this.mp = this.maxMp;
    this.feel.text(this.cx, this.y - 22, 'LEVEL UP!', COLORS.gold, 2);
    this.feel.sfx.play('levelup');
    this.feel.flash(0.25, COLORS.gold);
    this.feel.slowmo(0.35, 0.45);
    this.feel.burst(this.cx, this.cy, 24, {
      color: [COLORS.gold, COLORS.white], speed: 130, life: 0.6, grav: -80, drag: 2.5,
    });
    this.game.events.emit('levelUp', { level });
  }

  /** The attack spec of whatever's in the weapon slot (fists if empty). */
  get weapon(): WeaponSpec {
    return weaponSpecOf(this.equipment.get('weapon'));
  }

  /* ---------------- swallowed (the Devourer) ---------------- */

  /** A monster gulps the player down — and takes the weapon with it. */
  swallowBy(m: Monster): void {
    if (this.fsm.is('dead', 'swallowed') || this.invulnT > 0) return;
    this.swallowedBy = m;
    this.escapeN = 0;
    // Everything you're wearing goes down with you and rides inside the
    // beast until it dies — kill THIS one to get your gear back. (Snapshot
    // the slots first: unequip mutates the map we're iterating.)
    const taken: string[] = [];
    for (const [slot, id] of this.equipment.slots()) {
      this.equipment.unequip(slot);
      this.inventory.remove(id, this.inventory.count(id)); // GONE from the bag too
      taken.push(id);
    }
    if (taken.length) {
      this.syncStats();
      m.state.stolenItems = taken;
      this.feel.text(this.cx, this.y - 16, taken.length > 1 ? 'GEAR SWALLOWED!' : 'WEAPON SWALLOWED!', COLORS.red);
    }
    this.statuses.apply('devoured');
    this.fsm.set('swallowed');
    this.feel.hitstop(0.12);
    this.feel.shake(0.6);
    this.feel.flash(0.3, COLORS.purple);
    this.feel.sfx.play('gulp');
    this.game.events.emit('playerSwallowed', {});
  }

  swallowedUpdate(): string | void {
    const m = this.swallowedBy;
    if (!m || m.dead || this.hp <= 0) return this.releaseFromSwallow(false);
    // Pinned inside the beast.
    this.x = m.cx - this.w / 2;
    this.y = m.cy - this.h / 2;
    this.vx = 0;
    this.vy = 0;
    // Mash anything to struggle free.
    let mashed = 0;
    if (this.input.consumePress('attack')) mashed++;
    if (this.input.consumePress('jump')) mashed++;
    if (this.input.consumePress('dash')) mashed++;
    if (mashed > 0) {
      this.escapeN += mashed;
      this.feel.sfx.play('blip');
      this.feel.shake(0.08);
      this.feel.burst(m.cx, m.cy, 3, {
        color: [COLORS.purple, COLORS.white], speed: 50, life: 0.2, drag: 4,
      });
      if (this.escapeN >= this.escapeNeed) return this.releaseFromSwallow(true);
    }
  }

  /** Pop back out — burst free (with i-frames) or slide out of a corpse. */
  private releaseFromSwallow(burst: boolean): string {
    const m = this.swallowedBy;
    this.swallowedBy = null;
    this.statuses.remove('devoured');
    if (burst && m && !m.dead) {
      const dir = (m.facing * -1) as 1 | -1;
      this.vx = dir * 190;
      this.vy = -230;
      this.invulnT = 1.2;
      m.state.digestCd = 4; // the beast needs a breather before the next gulp
      m.state.victim = false;
      this.feel.impact(this.cx, this.cy, { strength: 0.7, dir, colors: [COLORS.purple, COLORS.white] });
      this.feel.sfx.play('dash');
    }
    return this.hp <= 0 ? 'dead' : 'move';
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
    // Shooting is a real action: enter `cast` so the body recoils.
    if (this.input.consumePress('skill') && this.skills.ready('fireball')) {
      this.pendingSkill = 'fireball';
      return 'cast';
    }
    if (this.input.consumePress('skill2') && this.skills.ready('nova')) {
      this.pendingSkill = 'nova';
      return 'cast';
    }
  }

  /** Fire the queued spell and brace into a recoil for the cast window. */
  beginCast(): void {
    const id = this.pendingSkill ?? 'fireball';
    this.pendingSkill = null;
    this.castDur = PLAYER_TUNING.castTime;
    const fired = this.skills.cast(id, { game: this.game, player: this });
    if (fired) this.vx -= this.facing * PLAYER_TUNING.castRecoil;
    else this.castDur = 0.08; // nothing left the hand — bail out fast
  }

  castUpdate(): string | void {
    this.vx *= 0.86; // braced stance
    if (this.fsm.t >= this.castDur) return 'move';
  }

  beginAttack(): void {
    const w = this.weapon;
    this.attackIndex = this.comboWin.consume() ? (this.attackIndex + 1) % 3 : 0;
    const heavy = this.attackIndex === 2;
    this.attackDur = heavy ? 0.3 : 0.2;
    // The lunge follows intent: full step when holding toward the target,
    // a nudge when neutral, NONE when holding away — so you can poke a
    // dangerous boss without being carried into his contact damage.
    const held = this.input.axis('left', 'right');
    const base = heavy ? PLAYER_TUNING.heavyAttackLunge : PLAYER_TUNING.attackLunge;
    const lunge = held === this.facing ? base : held === 0 ? base * 0.25 : 0;
    this.vx += this.facing * lunge;
    // Damage/feel come from the equipped weapon; flat bonus from stats;
    // EXECUTIONER (skill tree) boosts the finisher.
    const executioner = heavy && this.tree.has('w3') ? 2 : 0;
    this.strike = this.game.combat.strike({
      damage: (heavy ? w.heavyDamage : w.lightDamage) + Math.round(this.stats.get('attack')) + executioner,
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
    // DASH STRIKE (skill tree): the dash itself becomes a blade.
    this.dashStrike = this.tree.has('w4')
      ? this.game.combat.strike({
          damage: 1 + Math.round(this.stats.get('attack')),
          targets: 'enemy',
          attacker: this,
          strength: 0.5,
          colors: [COLORS.steel, COLORS.white],
        })
      : null;
  }

  dashUpdate(): string | void {
    this.vx = this.facing * PLAYER_TUNING.dashSpeed;
    this.vy = 0;
    this.dashStrike?.apply(this);
    if (Math.floor(this.fsm.t * 60) % 2 === 0) {
      this.feel.particles.spawn({
        x: this.cx - this.facing * 4, y: this.y + this.h - 2,
        vx: -this.facing * 20, vy: -10, life: 0.3, size: 3,
        color: this.dashStrike ? COLORS.white : COLORS.steel, drag: 4,
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

  /** Contact damage routes through Combat like every other hit source. */
  hurt(source: Monster): void {
    this.game.combat.hit(
      this,
      {
        damage: source.def.damage,
        targets: 'player',
        strength: 0.55,
        knockback: 170,
        popY: -160,
        colors: [COLORS.red, COLORS.white],
      },
      source,
    );
  }

  /**
   * Post-damage reaction for ANY hit on the player (contact, boss
   * shockwaves, projectiles). Combat has already applied damage,
   * knockback and the impact bundle; this adds the player-specific
   * channels: i-frames, red flash, hurt sound, combo reset.
   */
  onHurt(info: import('@engine/index').HitInfo): void {
    // Zero-damage hits (slime balls) skip i-frames and the hurt drama.
    if (info.damage <= 0) return;
    this.invulnT = PLAYER_TUNING.hurtInvuln;
    this.feel.sfx.play('hurt');
    this.feel.flash(0.35, COLORS.red);
    this.game.events.emit('playerHurt', { hp: this.hp });
    if (this.hp > 0 && !this.fsm.is('dead', 'swallowed')) this.fsm.set('move');
  }

  /** Called by Combat when hp hits 0. The corpse entity stays in the world. */
  onDeath(): void {
    this.die();
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
    this.statuses.update(dt);
    this.squash += (1 - this.squash) * Math.min(1, dt * 10);

    // Inside a Devourer: no physics, no buffers — just the struggle.
    if (this.fsm.is('swallowed')) {
      this.fsm.update(dt);
      return;
    }

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
      } else if (this.jumpBuf.active && this.airJumps > 0 && !this.fsm.is('dead', 'attack')) {
        // SKY DANCER (skill tree): kick off the air itself.
        this.jumpBuf.consume();
        this.airJumps--;
        this.vy = -T.doubleJumpSpeed;
        this.squash = 1.3;
        this.feel.sfx.play('doublejump');
        this.feel.burst(this.cx, this.y + this.h, 8, {
          color: [COLORS.white, COLORS.steel], speed: 55, life: 0.3,
          angle: Math.PI / 2, spread: 2.8, drag: 4,
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
      this.airJumps = this.tree.has('v4') ? 1 : 0;
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
    // contactInset shrinks the touch box for round-sprited monsters.
    if (!this.fsm.is('dead', 'dash') && this.invulnT <= 0) {
      for (const e of this.world.actors('enemy')) {
        if (e instanceof Monster && !e.def.noContactDamage &&
            overlaps(this, expand(e.hurtbox, -(e.def.contactInset ?? 0)))) {
          this.hurt(e);
          break;
        }
      }
    }
  }

  /** Ground/air movement control shared by the move state. */
  private runControls(dt: number): void {
    const T = PLAYER_TUNING;
    const speed = this.stats.get('speed'); // buffs/debuffs live here
    const dir = this.input.axis('left', 'right');
    if (dir !== 0) {
      this.facing = dir as 1 | -1;
      this.vx = clamp(this.vx + dir * T.runAccel * dt, -speed, speed);
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

  /**
   * Procedural body English, layered on top of squash & stretch so each
   * action reads distinctly even though the sprite set is tiny. Returns a
   * horizontal shear (upper body lean; negative leans the head toward +x),
   * a pixel offset, and extra scale. Anchored at the feet in render.
   */
  private bodyPose(): { shear: number; ox: number; oy: number; sx: number; sy: number } {
    const f = this.facing;

    if (this.fsm.is('dash')) {
      // Streak: head thrown ahead of the trailing feet.
      return { shear: -f * 0.34, ox: f * 1.5, oy: 0, sx: 1, sy: 1 };
    }

    if (this.fsm.is('attack')) {
      const prog = clamp(this.fsm.t / this.attackDur, 0, 1);
      const heavy = this.attackIndex === 2;
      const upper = this.attackIndex === 1;
      const mag = heavy ? 1.4 : 1;
      let shear: number;
      let ox: number;
      if (prog < 0.28) {
        const w = prog / 0.28; // wind up: coil back
        shear = f * 0.22 * mag * w;
        ox = -f * 2 * mag * w;
      } else if (prog < 0.55) {
        const s = (prog - 0.28) / 0.27; // strike: whip through
        shear = (f * 0.22 - f * 0.52 * s) * mag;
        ox = (-f * 2 + f * 5 * s) * mag;
      } else {
        const r = (prog - 0.55) / 0.45; // recover: settle to neutral
        shear = -f * 0.3 * mag * (1 - r);
        ox = f * 3 * mag * (1 - r);
      }
      let oy = 0;
      if (heavy) oy -= 3 * Math.sin(prog * Math.PI); // a committed hop
      if (upper) oy -= 2 * Math.sin(prog * Math.PI); // the uppercut rises
      return { shear, ox, oy, sx: 1, sy: 1 };
    }

    if (this.fsm.is('cast')) {
      const prog = clamp(this.fsm.t / this.castDur, 0, 1);
      const k = prog < 0.3 ? prog / 0.3 : 1 - (prog - 0.3) / 0.7; // snap back, ease out
      return { shear: f * 0.26 * k, ox: -f * 2 * k, oy: -k, sx: 1, sy: 1 };
    }

    // move / air: lean into horizontal motion; stretch on a fast rise,
    // pinch slightly on the fall — a subtle jump arc.
    const shear = -clamp(this.vx / 900, -0.18, 0.18);
    let sy = 1;
    if (!this.onGround) sy = 1 + clamp(-this.vy / 1600, -0.06, 0.1);
    return { shear, ox: 0, oy: 0, sx: 2 - sy, sy };
  }

  render(g: CanvasRenderingContext2D): void {
    // Inside a Devourer: the beast draws the bulge, not us.
    if (this.fsm.is('swallowed')) return;
    // I-frame blink.
    if (this.invulnT > 0 && !this.fsm.is('dead') && Math.floor(this.invulnT * 20) % 2) return;

    let anim = 'air';
    if (this.onGround) anim = Math.abs(this.vx) > 8 ? 'run' : 'idle';
    const set = this.facing === 1 ? KNIGHT_ANIMS.right : KNIGHT_ANIMS.left;
    let img = frameAt(set, anim, this.animT);
    if (this.flashT > 0) img = whiteOf(img);

    const cx = this.cx;
    const by = this.y + this.h;

    const q = (v: number) => Math.round(v * 4) / 4;
    if (this.fsm.is('dead')) {
      // Keel over and fade.
      g.save();
      g.translate(q(cx), q(by - 4));
      g.rotate(this.facing * (Math.PI / 2) * Math.min(1, this.deadT * 3));
      g.globalAlpha = Math.max(0, 1 - Math.max(0, this.deadT - 0.8));
      g.drawImage(img, -6, -9, img.width / TEXEL, img.height / TEXEL);
      g.restore();
      g.globalAlpha = 1;
      return;
    }

    // Squash & stretch + per-action body English, anchored at the feet.
    const pose = this.bodyPose();
    const baseSy = this.squash;
    const baseSx = 1 + (1 - baseSy) * 0.7;
    const sx = baseSx * pose.sx;
    const sy = baseSy * pose.sy;
    g.save();
    g.translate(q(cx + pose.ox), q(by + pose.oy));
    g.scale(sx, sy);
    if (pose.shear) g.transform(1, 0, pose.shear, 1, 0, 0);
    g.drawImage(img, -6, -14, img.width / TEXEL, img.height / TEXEL);
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
  cast: {
    enter: (p) => p.beginCast(),
    update: (p) => p.castUpdate(),
  },
  dead: {
    update: (p, dt) => {
      p.deadT += dt;
    },
  },
  swallowed: {
    update: (p) => p.swallowedUpdate(),
  },
};
