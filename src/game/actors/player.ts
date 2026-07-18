import {
  Actor,
  FSM,
  Buffer,
  Strike,
  applyGravity,
  moveAndCollide,
  frameAt,
  whiteOf,
  tintOf,
  friction,
  clamp,
  overlaps,
  expand,
  chance,
  drawText,
  type Input,
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
import { KNIGHT_ANIMS, baseKnight } from '../content/sprites';
import { gearLayers, DEBUG_ANCHORS } from '../content/gear-visuals';
import { COLORS } from '../content/palette';
import {
  weaponDefOf,
  weaponTypeOf,
  type WeaponAttackDef,
  type WeaponDef,
} from '../content/weapons';
import { drawHeldWeapon, drawWeaponTrail } from '../content/weapon-visuals';
import { DEFAULT_SKILL_LOADOUT, type SkillCtx } from '../content/skills';
import { Monster } from './monster';
import { PlayerCapabilities } from './player-capabilities';
import { QuestLog } from '../content/quests';
import type { World } from '@engine/index';
import type { ActionGame, Action } from '../defs';

/** The living player nearest to (x, y) — for AI targeting, pickup
 * magnets, and NPC prompts, which all stop assuming a lone knight. */
export function nearestPlayer(world: World, x: number, y: number): Player | null {
  let best: Player | null = null;
  let bd = Infinity;
  for (const a of world.actors('player')) {
    if (!(a instanceof Player) || a.hp <= 0) continue;
    const d = Math.hypot(a.cx - x, a.cy - y);
    if (d < bd) { bd = d; best = a; }
  }
  return best;
}

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
  castTime: 0.2, // brief commit while a spell leaves the hand
  castRecoil: 40, // backward brace when a spell fires
  hurtInvuln: 1.1,
  maxHp: 5,
  maxMp: 3,
};

/**
 * The player knight: an FSM over move/attack/dash/dead, with the classic
 * feel kit — coyote time, jump buffering, jump cut, attack buffering,
 * squash & stretch, dash i-frames, and definition-driven weapon combos.
 */
export class Player extends Actor {
  team = 'player' as const;
  w = baseKnight.hitbox.w;
  h = baseKnight.hitbox.h;
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
  /** The body sprite set. Visible gear draws as layers on top (see
   * content/gear-visuals.ts), so the body never needs per-loadout art.
   * Live read so a PNG-sheet swap (loadKnightSheet) takes effect. */
  get animSet() {
    return KNIGHT_ANIMS;
  }
  statuses = new Statuses(this);
  gold = 0;

  /** XP curve: 40 XP for level 1→2, +25 per level after. */
  progression = new Progression(
    (level) => 40 + (level - 1) * 25,
    1,
    (level) => this.onLevelUp(level),
  );
  tree = new SkillTree<TreeCtx>({ stats: this.stats, syncStats: () => this.syncStats() });
  capabilities = new PlayerCapabilities();
  /** Accepted/completed quests (persisted; see content/quests.ts). */
  quests = new QuestLog();
  /** Blacksmith weapon upgrades: each level adds +1 attack (persisted). */
  forgeLevel = 0;
  skills = new SkillBook<SkillCtx>(
    {
      canAfford: (cost) => this.mp >= cost,
      spend: (cost) => {
        this.mp -= cost;
      },
    },
    () => this.capabilities.modifier('skillCooldownScale', 1),
  );
  mp = PLAYER_TUNING.maxMp;

  /** Net puppets: authoritative maxMp from the host (stats live there). */
  mpCap: number | null = null;

  get maxMp(): number {
    if (this.mpCap !== null) return this.mpCap;
    return Math.round(this.stats.get('maxMp'));
  }

  private jumpBuf = new Buffer(PLAYER_TUNING.jumpBufferTime);
  private atkBuf = new Buffer(PLAYER_TUNING.attackBufferTime);
  private coyote = new Buffer(PLAYER_TUNING.coyoteTime);
  private comboT = 0;
  private comboWeaponId = 'unarmed';

  /** Vertical squash factor for landing/jumping (1 = normal). */
  squash = 1;
  private wasGround = false;
  private dashCd = 0;
  private attackIndex = 0;
  private attackDur = 0;
  private attackDef: WeaponAttackDef | null = null;
  private strike: Strike | null = null;
  /** Active spell + its animation window (the `cast` state). */
  private pendingSkill: string | null = null;
  private castDur = 0;
  deadT = 0;

  /** Debug god mode (cheat): no damage, always topped up. */
  godMode = false;

  /** Monster currently holding the player through its swallow strategy. */
  swallowedBy: Monster | null = null;
  escapeN = 0;
  get escapeNeed(): number {
    return this.swallowedBy?.def.swallow?.escapeNeed ?? 7;
  }

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
    for (const slot of DEFAULT_SKILL_LOADOUT) {
      if (slot.startsKnown) this.skills.learn(slot.skillId);
    }
    this.syncStats();
    this.hp = this.maxHp;
    this.mp = this.maxMp;
    this.fsm = new FSM<Player>(this, PLAYER_STATES, 'move');
  }

  /** Project the forge upgrades into stats (call after forgeLevel changes). */
  applyForge(): void {
    this.stats.setSource('forge', { add: { attack: this.forgeLevel } });
    this.syncStats();
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

  /** The registered weapon in the equipment slot (fists if empty). */
  get weapon(): WeaponDef {
    return weaponDefOf(this.equipment.get('weapon'));
  }

  /* ---------------- definition-owned swallow interactions ---------------- */

  /** Enter the generic held state; the monster definition owns its effects. */
  swallowBy(m: Monster): void {
    const effect = m.def.swallow;
    if (!effect || this.fsm.is('dead', 'swallowed') || this.invulnT > 0) return;
    this.swallowedBy = m;
    this.escapeN = 0;
    this.feel.text(this.cx, this.y - 16, effect.message ?? 'SWALLOWED!', COLORS.red);
    if (effect.status) this.statuses.apply(effect.status);
    effect.onEnter?.(m, this);
    this.fsm.set('swallowed');
    this.feel.hitstop(0.12);
    this.feel.shake(0.6);
    this.feel.flash(0.3, effect.colors?.[0] ?? COLORS.purple);
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
    const effect = m?.def.swallow;
    if (effect?.status) this.statuses.remove(effect.status);
    if (burst && m && !m.dead) {
      const dir = (m.facing * -1) as 1 | -1;
      this.vx = dir * 190;
      this.vy = -230;
      this.invulnT = 1.2;
      this.feel.impact(this.cx, this.cy, { strength: 0.7, dir, colors: effect?.colors ?? [COLORS.purple, COLORS.white] });
      this.feel.sfx.play('dash');
    }
    if (m) effect?.onRelease?.(m, this, burst);
    return this.hp <= 0 ? 'dead' : 'move';
  }

  /** Shown as a floating tag over the knight — set only in multiplayer,
   * so solo play stays clean. */
  name = '';

  /** Input driving this knight. Defaults to the local device; a net
   * session substitutes a remote-fed Input for the guest's knight. */
  source: Input<Action> | null = null;

  get input() {
    return this.source ?? this.game.input;
  }

  /** True when this knight answers to the local device (menus, prompts,
   * NPC talk keys) rather than a remote player's stream. */
  get isLocal(): boolean {
    return this.source === null;
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
    for (const slot of DEFAULT_SKILL_LOADOUT) {
      if (this.input.consumePress(slot.action) && this.skills.ready(slot.skillId)) {
        this.pendingSkill = slot.skillId;
        return 'cast';
      }
    }
  }

  /** Fire the queued spell and brace into a recoil for the cast window. */
  beginCast(): void {
    const id = this.pendingSkill;
    this.pendingSkill = null;
    if (!id) {
      this.castDur = 0.08;
      return;
    }
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
    const type = weaponTypeOf(w);
    const continues = this.comboT > 0 && this.comboWeaponId === w.id;
    this.attackIndex = continues ? (this.attackIndex + 1) % type.attacks.length : 0;
    this.comboT = 0;
    this.attackDef = type.attacks[this.attackIndex];
    this.attackDur = this.attackDef.duration;
    // The lunge follows intent: full step when holding toward the target,
    // a nudge when neutral, NONE when holding away — so you can poke a
    // dangerous boss without being carried into his contact damage.
    const held = this.input.axis('left', 'right');
    const base = this.attackDef.lunge;
    const lunge = held === this.facing ? base : held === 0 ? base * 0.05 : 0;
    this.vx += this.facing * lunge;
    // Damage/feel come from the equipped weapon; flat bonus from stats;
    // EXECUTIONER (skill tree) boosts the finisher.
    const executioner = this.attackDef.finisher && this.capabilities.has('heavyFinisherBonus') ? 2 : 0;
    this.strike = this.game.combat.strike({
      damage: Math.round(w.baseDamage * this.attackDef.damageScale)
        + Math.round(this.stats.get('attack'))
        + executioner,
      targets: 'enemy',
      attacker: this,
      strength: this.attackDef.strength,
      colors: [...w.colors],
    });
    this.feel.sfx.play('slash');
  }

  attackUpdate(dt: number): string | void {
    const attack = this.attackDef;
    if (!attack) return 'move';
    this.vx *= friction(attack.movementKeep, dt);
    const prog = this.fsm.t / this.attackDur;
    if (prog > attack.active[0] && prog < attack.active[1]) this.strike?.apply(this.attackBox());
    if (prog >= 1) {
      const weapon = this.weapon;
      this.comboT = weaponTypeOf(weapon).comboWindow;
      this.comboWeaponId = weapon.id;
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
    this.dashStrike = this.capabilities.has('dashStrike')
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
    const hitbox = this.attackDef?.hitbox;
    if (!hitbox) return { x: this.x, y: this.y, w: 0, h: 0 };
    return {
      x: this.facing === 1
        ? this.x + this.w + hitbox.forward
        : this.x - hitbox.forward - hitbox.w,
      y: this.y + this.h / 2 - hitbox.h / 2 + hitbox.y,
      w: hitbox.w,
      h: hitbox.h,
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
    this.comboT = 0;
    this.game.events.emit('playerHurt', { hp: this.hp });
    if (this.hp > 0 && !this.fsm.is('dead', 'swallowed')) this.fsm.set('move');
  }

  /** Called by Combat when hp hits 0. The corpse entity stays in the world. */
  onDeath(): void {
    this.die();
  }

  private die(): void {
    if (this.swallowedBy) this.releaseFromSwallow(false);
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
    // God mode (cheat): keep i-frames live and resources topped up.
    if (this.godMode) {
      this.invulnT = Math.max(this.invulnT, 0.5);
      this.hp = this.maxHp;
      this.mp = this.maxMp;
    }
    this.tickTimers(dt);
    this.jumpBuf.update(dt);
    this.atkBuf.update(dt);
    this.coyote.update(dt);
    this.comboT = Math.max(0, this.comboT - dt);
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
      this.airJumps = this.capabilities.modifier('airJumps', 0);
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
        if (e instanceof Monster && overlaps(this, expand(e.hurtbox, -(e.def.contactInset ?? 0)))) {
          const handled = e.def.onPlayerContact?.(e, this) === true;
          if (!handled && !e.def.noContactDamage) this.hurt(e);
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
      const attack = this.attackDef;
      if (!attack) return { shear: 0, ox: 0, oy: 0, sx: 1, sy: 1 };
      const mag = attack.bodyWeight;
      let shear: number;
      let ox: number;
      if (prog < attack.active[0]) {
        const w = prog / attack.active[0]; // wind up: coil back
        shear = f * 0.22 * mag * w;
        ox = -f * 2 * mag * w;
      } else if (prog < attack.active[1]) {
        const s = (prog - attack.active[0]) / (attack.active[1] - attack.active[0]);
        shear = (f * 0.22 - f * 0.52 * s) * mag;
        ox = (-f * 2 + f * 5 * s) * mag;
      } else {
        const r = (prog - attack.active[1]) / (1 - attack.active[1]);
        shear = -f * 0.3 * mag * (1 - r);
        ox = f * 3 * mag * (1 - r);
      }
      const oy = -attack.lift * Math.sin(prog * Math.PI);
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
    // Name tag (multiplayer): who is this knight. Drawn before the
    // i-frame blink so the tag holds steady while the body strobes.
    if (this.name) drawText(g, this.name, this.cx, this.y - 4, COLORS.steel, 1, 'center');
    // I-frame blink (god mode holds i-frames but shouldn't strobe).
    if (this.invulnT > 0 && !this.godMode && !this.fsm.is('dead') && Math.floor(this.invulnT * 20) % 2) return;

    let anim = 'air';
    if (this.onGround) anim = Math.abs(this.vx) > 8 ? 'run' : 'idle';
    const set = this.facing === 1 ? this.animSet.right : this.animSet.left;
    let img = frameAt(set, anim, this.animT);
    if (this.flashT > 0) img = whiteOf(img);

    // Entity coordinates describe the collision box. Sprite geometry maps
    // its draw origin onto that box, allowing transparent overhangs without
    // changing physics.
    const cx = this.x - baseKnight.hitbox.x + baseKnight.w / 2;
    const by = this.y - baseKnight.hitbox.y + baseKnight.h;
    const dh = baseKnight.h;
    const dw = baseKnight.w;

    const q = (v: number) => Math.round(v * 4) / 4;
    if (this.fsm.is('dead')) {
      // Keel over and fade.
      g.save();
      g.translate(q(cx), q(by - 4));
      g.rotate(this.facing * (Math.PI / 2) * Math.min(1, this.deadT * 3));
      g.globalAlpha = Math.max(0, 1 - Math.max(0, this.deadT - 0.8));
      g.drawImage(img, -dw / 2, -dh * 0.7, dw, dh);
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
    
    let finalImg = img;
    const isSwallowed = this.fsm.is('swallowed');
    if (isSwallowed) {
      g.globalAlpha = 0.9; // keep player highly visible
      // Pain shiver translation
      const shiverX = Math.sin(this.animT * 50) * 0.8;
      const shiverY = Math.cos(this.animT * 50) * 0.8;
      g.translate(q(cx + pose.ox + shiverX), q(by + pose.oy + shiverY));
      // Tint the player red for acid pain/damage!
      finalImg = tintOf(img, COLORS.red, 0.55);
    } else {
      g.translate(q(cx + pose.ox), q(by + pose.oy));
    }
    
    g.scale(sx, sy);
    if (pose.shear) g.transform(1, 0, pose.shear, 1, 0, 0);
    g.drawImage(finalImg, -dw / 2, -dh, dw, dh);

    const animObj = this.animSet.right[anim];
    const frameIdx = animObj
      ? (animObj.loop === false
        ? Math.min(Math.floor(this.animT * animObj.fps), animObj.frames.length - 1)
        : Math.floor(this.animT * animObj.fps) % animObj.frames.length)
      : 0;
    
    // Visible gear draws as registered layers over the body (armor under
    // helmet, etc). Any equipped slot with a visual in the gear-visuals
    // registry composites here — new gear slots need no player changes.
    if (this.flashT <= 0 && !isSwallowed) {
      const f = this.facing;

      for (const [slot, visual] of gearLayers()) {
        if (this.equipment.get(slot) === null) continue;
        const layerSet = f === 1 ? visual.anims.right : visual.anims.left;
        const layerImg = frameAt(layerSet, anim, this.animT);
        const anchor = visual.anchors?.[anim]?.[frameIdx] ?? { x: 0, y: 0, angle: 0 };

        g.save();
        g.translate(anchor.x * f, anchor.y);
        if (anchor.angle) g.rotate(anchor.angle * f);
        g.drawImage(layerImg, -dw / 2, -dh, dw, dh);
        if (DEBUG_ANCHORS) {
          g.fillStyle = '#ff0000';
          g.fillRect(-1, -1, 2, 2);
        }
        g.restore();
      }
    }
    
    if (isSwallowed && this.swallowedBy) {
      this.swallowedBy.def.swallow?.drawPlayerOverlay?.(g, this.swallowedBy, this, dw, dh);
    }
    
    // Equipment visuals ride the same body transform as the knight.
    if (this.flashT <= 0) {
      if (this.equipment.get('charm')) this.renderCharm(g, dh);
      const weapon = this.weapon;
      drawHeldWeapon(g, weapon.visual, {
        facing: this.facing,
        anim,
        frame: frameIdx,
        animT: this.animT,
        bodyW: dw,
        bodyH: dh,
        attack: this.fsm.is('attack')
          ? {
              progress: Math.min(1, this.fsm.t / this.attackDur),
              def: this.attackDef!,
            }
          : undefined,
      });
    }
    g.restore();
    g.globalAlpha = 1;

    if (this.fsm.is('attack')) {
      const weapon = this.weapon;
      drawWeaponTrail(g, weapon.visual, {
        x: cx,
        y: by - dh * 0.45,
        facing: this.facing,
        colors: [...weapon.colors],
        attack: {
          progress: Math.min(1, this.fsm.t / this.attackDur),
          def: this.attackDef!,
        },
      });
    }
  }

  /** A small charm glint on the chest when a charm is worn. */
  private renderCharm(g: CanvasRenderingContext2D, dh: number): void {
    const cy = -Math.round(dh * 0.5);
    g.fillStyle = COLORS.gold;
    g.fillRect(-1, cy, 2, 2);
    g.fillStyle = COLORS.white;
    g.fillRect(0, cy, 1, 1);
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
