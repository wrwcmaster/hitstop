import {
  Actor,
  FSM,
  Buffer,
  Charge,
  Strike,
  Projectile,
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
  rand,
  swim,
  drawText,
  t,
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
import { drawHeldWeapon, drawWeaponTrail, RANGED_HAND_Y } from '../content/weapon-visuals';
import { type SkillCtx } from '../content/skills';
import { classes, DEFAULT_CLASS } from '../content/classes';
import { shootArrow, shootBullet, muzzleFlash } from '../content/ballistics';
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

/** The living enemy nearest to (x, y) — reflected shots seek it. */
function nearestMonster(world: World, x: number, y: number): Monster | null {
  let best: Monster | null = null;
  let bd = Infinity;
  for (const a of world.actors('enemy')) {
    if (!(a instanceof Monster) || a.dead || a.hp <= 0) continue;
    const d = Math.hypot(a.cx - x, a.cy - y);
    if (d < bd) { bd = d; best = a; }
  }
  return best;
}

/** Movement + combat tuning in one place. Tweak freely. */
/**
 * Water feel. Buoyancy beats gravity once you're deep, so the knight
 * bobs to the surface on her own; strokes (jump) kick upward, holding
 * down dives, and a stroke near the surface breaches into a real jump.
 * Armor doesn't rust, but lungs are lungs: `airSeconds` underwater,
 * then a heart per `drownEvery` until you surface.
 */
const SWIM = {
  buoyancy: 0.82, // < 1× gravity: slightly heavy, so you sink slowly by default
  dragY: 0.1, // per-second velocity keep factors (heavy water)
  dragX: 0.5,
  swimUp: 520, // px/s² upward while holding jump (ascend)
  dive: 340, // px/s² downward while holding down (dive faster)
  maxRise: 95, // ascent cap while holding jump
  driftSink: 30, // gentle sink cap when not diving — "slowly sinking"
  maxSink: 100, // faster sink cap while holding down
  swimSpeed: 66, // horizontal cap in water (slower than the land runSpeed)
  breachDepth: 0.55, // shallower than this, a jump press launches you out
  airSeconds: 8,
  refillSeconds: 2,
  drownEvery: 1,
};

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
  drawMoveMult: 0.45, // drawing a bow you can creep, not sprint
  // Parry: a short deflect window; land a hit inside it and the blow is
  // turned aside, the attacker staggered, and a riposte opened.
  parryWindow: 0.16, // the active guard (hits inside are deflected)
  parryRecovery: 0.22, // committed lag after the window
  parryCooldown: 0.4, // wait after the stance ends before guarding again
  parryIFrames: 0.4, // grace granted on a successful parry
  parryStagger: 0.55, // how long a parried melee attacker is stunned
  riposteTime: 1.3, // window to cash in the empowered counter
  riposteBonus: 3, // extra damage on the riposte swing
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
  /** Active class (see content/classes.ts). */
  classId = DEFAULT_CLASS;
  /** Dormant classes' unlocked nodes, by class id (persisted). The
   * active class's nodes live in `tree` and are parked here on change. */
  private ownedByClass: Record<string, string[]> = {};
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
  /** Ranged weapon: a queued shot + the reload clock. */
  private pendingRanged = false;
  private rangedCd = 0;
  /** Hold-to-charge (the `draw` state): the engine gesture plus the
   * power the release banked for fireRanged (1 = uncharged weapons). */
  private charge = new Charge({ time: 1, floor: 1 });
  private chargePower = 1;
  /** Parry: reload clock between guards, and the empowered-counter window. */
  private parryCd = 0;
  riposteT = 0;
  private parriedThisWindow = false;
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
    // Starting kit: a weapon in hand, a potion in the bag, and the
    // starting class's base modifiers + known spells.
    this.inventory.add('rusty-sword');
    this.equipment.equip('rusty-sword');
    this.inventory.add('potion');
    this.applyClass();
    this.syncStats();
    this.hp = this.maxHp;
    this.mp = this.maxMp;
    this.fsm = new FSM<Player>(this, PLAYER_STATES, 'move');
  }

  /** The active class's definition (loadout, tree grid, colors). */
  get classDef() {
    return classes.get(this.classId);
  }

  /** Apply the active class's base mods + starting skills (idempotent). */
  private applyClass(): void {
    const def = this.classDef;
    if (def.mods) this.stats.setSource(`class:${this.classId}`, def.mods);
    for (const slot of def.loadout) {
      if (slot.startsKnown) this.skills.learn(slot.skillId);
    }
  }

  /**
   * Change class. Non-destructive: the old class parks its unlocked
   * nodes (and keeps them for a return trip), every effect it granted is
   * stripped — tree stat mods, class mods, capabilities, skills — and
   * the new class's base kit + remembered nodes are replayed, exactly
   * like a save restore. Skill points are a shared pool, untouched.
   */
  setClass(id: string): boolean {
    if (id === this.classId || !classes.has(id)) return false;
    this.ownedByClass[this.classId] = this.tree.ownedIds();
    for (const nid of this.tree.ownedIds()) this.stats.removeSource(`tree:${nid}`);
    this.stats.removeSource(`class:${this.classId}`);
    this.capabilities.reset();
    this.skills.known.length = 0;
    this.classId = id;
    this.applyClass();
    this.tree = new SkillTree<TreeCtx>({ stats: this.stats, syncStats: () => this.syncStats() });
    this.tree.restore(this.ownedByClass[id] ?? [], { game: this.game, player: this });
    this.syncStats();
    this.mp = Math.min(this.mp, this.maxMp);
    return true;
  }

  /** Restore class + all class trees from a save (active tree replays). */
  restoreClasses(classId: string, trees: Record<string, string[]>): void {
    this.ownedByClass = { ...trees };
    if (classId !== this.classId && classes.has(classId)) {
      // setClass parks the constructor class's (empty) live tree over the
      // saved list — remember the saved one and put it back after.
      const prev = this.classId;
      const saved = this.ownedByClass[prev] ?? [];
      this.setClass(classId);
      this.ownedByClass[prev] = saved;
    } else {
      this.tree.restore(this.ownedByClass[this.classId] ?? [], { game: this.game, player: this });
    }
  }

  /** Every class's unlocked nodes (for save files), active class current. */
  snapshotTrees(): Record<string, string[]> {
    return { ...this.ownedByClass, [this.classId]: this.tree.ownedIds() };
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

  /** How deep in water the body sits (0 dry .. 1 fully under). */
  submersion = 0;
  /** Breath remaining (0..1). Depletes with the head underwater. */
  air = 1;
  private drownT = SWIM.drownEvery;
  private wasWet = false;

  /** Which move the next/current attack is: the grounded combo chain or
   * a contextual strike (set right before entering the attack state). */
  private attackContext: 'ground' | 'aerial' | 'plunge' | 'upper' | 'dash' = 'ground';

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
    // Parry is a reaction: raise the guard on demand (ground or air).
    if (this.input.consumePress('parry') && this.parryCd <= 0) return 'parry';
    if (this.atkBuf.consume()) {
      // Ranged steel shoots instead of swinging. Charged weapons (the
      // bow) enter the draw state — the shot leaves on RELEASE, at a
      // power the hold decides. Uncharged ones (the flintlock) fire on
      // the press as ever, straight into the recoil brace.
      const rangedType = weaponTypeOf(this.weapon);
      if (rangedType.ranged) {
        if (this.rangedCd <= 0) {
          if (rangedType.ranged.charge) return 'draw';
          this.pendingRanged = true;
          return 'cast';
        }
        return; // dry-fire: the reload isn't done
      }
      // Context picks the move: airborne+down plunges, up-held swings
      // overhead, airborne swipes aerial, grounded runs the combo chain.
      // Not in water, though: tucking down there is how you hold depth,
      // so a submerged swing stays a swipe at what's beside you.
      const type = weaponTypeOf(this.weapon);
      const dry = this.submersion <= 0.2;
      if (!this.onGround && dry && this.input.held('down') && type.plunge) this.attackContext = 'plunge';
      else if (this.input.held('up') && type.upper) this.attackContext = 'upper';
      else if (!this.onGround && type.aerial) this.attackContext = 'aerial';
      else this.attackContext = 'ground';
      return 'attack';
    }
    if (this.input.consumePress('dash') && this.dashCd <= 0) return 'dash';
    // Shooting is a real action: enter `cast` so the body recoils.
    for (const slot of this.classDef.loadout) {
      if (this.input.consumePress(slot.action) && this.skills.ready(slot.skillId)) {
        this.pendingSkill = slot.skillId;
        return 'cast';
      }
    }
  }

  /** Fire the queued spell and brace into a recoil for the cast window. */
  beginCast(): void {
    if (this.pendingRanged) {
      this.pendingRanged = false;
      this.fireRanged();
      return;
    }
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

  /* ---------------- draw (hold-to-charge ranged) ---------------- */

  /** Nock and start pulling: the hold decides the power (see Charge). */
  beginDraw(): void {
    const r = weaponTypeOf(this.weapon).ranged!;
    this.charge.begin(r.charge!);
    this.squash = 0.95;
    this.feel.sfx.play('bowdraw');
  }

  drawUpdate(dt: number): string | void {
    // Creep while drawing: same controls as running, at drawMoveMult
    // pace — an archer tracks their target, they don't sprint with a
    // drawn string. Turning mid-draw re-aims.
    const T = PLAYER_TUNING;
    const dir = this.input.axis('left', 'right');
    if (dir !== 0) {
      this.facing = dir as 1 | -1;
      const cap = this.stats.get('speed') * T.drawMoveMult;
      this.vx = clamp(this.vx + dir * T.runAccel * T.drawMoveMult * dt, -cap, cap);
    } else {
      this.vx *= friction(this.onGround ? T.groundFriction : T.airFriction, dt);
    }
    // Bail out without loosing: a dash or parry eats the arrow.
    if (this.input.consumePress('dash') && this.dashCd <= 0) return 'dash';
    if (this.input.consumePress('parry') && this.parryCd <= 0) return 'parry';
    // The "fully drawn" click — the last beat of the ramp just landed.
    const handY = this.y + this.h + RANGED_HAND_Y;
    if (this.charge.update(dt)) {
      this.feel.sfx.play('parryReady');
      this.feel.burst(this.cx + this.facing * 7, handY, 5, {
        color: [COLORS.gold, COLORS.white], speed: 30, life: 0.2, drag: 6,
      });
      this.squash = 0.9;
    }
    // Creeping tension: sparks gather at the arrowhead while pulling.
    if (!this.charge.full && Math.floor(this.fsm.t / 0.15) !== Math.floor((this.fsm.t - dt) / 0.15)) {
      this.feel.burst(this.cx + this.facing * 7, handY, 1, {
        color: [COLORS.steel], speed: 14, life: 0.14, drag: 4,
      });
    }
    // Release looses the shot at whatever the hold earned.
    if (!this.input.held('attack')) {
      this.chargePower = this.charge.power;
      this.pendingRanged = true;
      return 'cast';
    }
  }

  /** Loose the equipped ranged weapon along the current aim. */
  private fireRanged(): void {
    const w = this.weapon;
    const r = weaponTypeOf(w).ranged!;
    const power = this.chargePower;
    this.chargePower = 1;
    this.castDur = 0.16;
    this.rangedCd = r.cooldown;
    // Aim: level by default, 45° up with up held, steep down mid-air.
    let angle = 0;
    if (this.input.held('up')) angle = -Math.PI / 4;
    else if (!this.onGround && this.input.held('down')) angle = Math.PI / 3;
    // Power scales the muzzle speed — under gravity, that IS the range —
    // and the punch and kick with it. Uncharged weapons fire at 1.
    const speed = r.speed * power;
    const vx = Math.cos(angle) * speed * this.facing;
    const vy = Math.sin(angle) * speed;
    // Spawn ON the weapon: the same feet-relative hand line the held
    // visual draws at (see RANGED_HAND_Y), plus the weapon's small trim —
    // never a body-center guess that drifts from the art.
    const mx = this.cx + this.facing * 7;
    const my = this.y + this.h + RANGED_HAND_Y + (r.muzzleY ?? 0);
    const shot = {
      x: mx, y: my, vx, vy,
      damage: Math.max(1, Math.round((w.baseDamage + this.stats.get('attack')) * power)),
      targets: 'enemy' as const,
      attacker: this,
      gravity: r.gravity,
    };
    if (r.projectile === 'arrow') shootArrow(this.game, this.collision, shot);
    else shootBullet(this.game, this.collision, shot);
    muzzleFlash(this.game, mx, my, this.facing, r.projectile);
    this.vx -= this.facing * r.recoil * power;
    this.squash = 0.92;
  }

  /* ---------------- parry ---------------- */

  /** Raise the guard: the deflect window opens for a beat, then commits. */
  beginParry(): void {
    this.parrying = true;
    this.parriedThisWindow = false;
    this.squash = 0.85;
    this.feel.sfx.play('parryReady');
    this.feel.burst(this.cx + this.facing * 6, this.cy, 4, {
      color: [COLORS.white, COLORS.steel], speed: 40, life: 0.18,
      angle: this.facing === 1 ? 0 : Math.PI, spread: 1.2, drag: 5,
    });
  }

  parryUpdate(dt: number): string | void {
    const T = PLAYER_TUNING;
    this.vx *= friction(0.02, dt); // planted stance
    const active = this.fsm.t < T.parryWindow;
    this.parrying = active;
    // While the guard is up, catch and turn back incoming shots.
    if (active) this.deflectProjectiles();
    if (this.fsm.t >= T.parryWindow + T.parryRecovery) {
      this.parryCd = T.parryCooldown;
      return 'move';
    }
  }

  /** Reflect any player-bound projectile inside the guard arc. */
  private deflectProjectiles(): void {
    const guard: Rect = { x: this.x - 6, y: this.y - 6, w: this.w + 12, h: this.h + 12 };
    for (const e of this.game.world.all()) {
      if (!(e instanceof Projectile) || e.dead) continue;
      if (e.targetTeam !== 'player') continue;
      if (!overlaps(guard, e.box)) continue;
      // Fling it back — toward the nearest foe if there is one, else the
      // way it came — now dangerous to enemies, with a little extra bite.
      const foe = nearestMonster(this.game.world, this.cx, this.cy);
      const speed = Math.hypot(e.vx, e.vy) || 300;
      let dx = foe ? foe.cx - e.x : -e.vx;
      let dy = foe ? foe.cy - e.y : -e.vy;
      const d = Math.hypot(dx, dy) || 1;
      e.reflect((dx / d) * speed * 1.15, (dy / d) * speed * 1.15, 2);
      this.parrySuccess(null);
    }
  }

  /** Called by combat when the raised guard turned a blow aside. */
  onParried(opts: import('@engine/index').StrikeOptions): void {
    this.parrySuccess((opts.attacker as Actor | null) ?? null);
  }

  /** The reward: no damage, a stunned attacker, and an empowered counter. */
  private parrySuccess(attacker: Actor | null): void {
    const T = PLAYER_TUNING;
    // Stagger a melee attacker (projectiles have no body to knock).
    if (attacker && attacker instanceof Monster) {
      attacker.hitstun = Math.max(attacker.hitstun, T.parryStagger);
      attacker.flashT = Math.max(attacker.flashT, 0.12);
      const away = attacker.cx >= this.cx ? 1 : -1;
      attacker.vx += away * 200 / attacker.mass;
    }
    // The fanfare + rewards land once per window (many shots may deflect).
    this.invulnT = Math.max(this.invulnT, T.parryIFrames);
    if (this.parriedThisWindow) {
      this.feel.burst(this.cx + this.facing * 8, this.cy, 5, {
        color: [COLORS.gold, COLORS.white], speed: 90, life: 0.2, drag: 5,
      });
      return;
    }
    this.parriedThisWindow = true;
    this.riposteT = T.riposteTime;
    this.dashCd = 0; // the counter footwork is free
    this.airJumps = this.capabilities.modifier('airJumps', 0);
    this.feel.sfx.play('parry');
    this.feel.flash(0.14, COLORS.gold);
    this.feel.shake(0.35);
    this.feel.slowmo(0.35, 0.12);
    this.feel.burst(this.cx + this.facing * 8, this.cy - 2, 12, {
      color: [COLORS.gold, COLORS.white], speed: 150, life: 0.3, drag: 3,
    });
    this.feel.text(this.cx, this.y - 6, t('PARRY!'), COLORS.gold, 1);
  }

  beginAttack(): void {
    const w = this.weapon;
    const type = weaponTypeOf(w);
    const ctx = this.attackContext;
    if (ctx === 'ground') {
      const continues = this.comboT > 0 && this.comboWeaponId === w.id;
      this.attackIndex = continues ? (this.attackIndex + 1) % type.attacks.length : 0;
      this.attackDef = type.attacks[this.attackIndex];
    } else {
      // Contextual moves sit outside the combo chain (and never advance it).
      const table = { aerial: type.aerial, plunge: type.plunge, upper: type.upper, dash: type.dashAttack };
      this.attackDef = table[ctx] ?? type.attacks[0];
      this.attackIndex = 0;
    }
    this.comboT = 0;
    this.attackDur = this.attackDef.duration;
    // The lunge follows intent: full step when holding toward the target,
    // a nudge when neutral, NONE when holding away — so you can poke a
    // dangerous boss without being carried into his contact damage.
    // (A dash attack always commits the full lunge — that's the point.)
    const held = this.input.axis('left', 'right');
    const base = this.attackDef.lunge;
    const lunge = ctx === 'dash' ? base : held === this.facing ? base : held === 0 ? base * 0.05 : 0;
    this.vx += this.facing * lunge;
    if (ctx === 'plunge') {
      // Point the steel down and commit: the fall is the weapon.
      this.vy = Math.max(this.vy, 240);
      this.vx *= 0.4;
    }
    // Damage/feel come from the equipped weapon; flat bonus from stats;
    // EXECUTIONER (skill tree) boosts the finisher.
    const executioner = this.attackDef.finisher && this.capabilities.has('heavyFinisherBonus') ? 2 : 0;
    // RIPOSTE: the swing after a parry lands harder and shines gold.
    const riposte = this.riposteT > 0;
    if (riposte) this.riposteT = 0;
    this.strike = this.game.combat.strike({
      damage: Math.round(w.baseDamage * this.attackDef.damageScale)
        + Math.round(this.stats.get('attack'))
        + executioner
        + (riposte ? PLAYER_TUNING.riposteBonus : 0),
      targets: 'enemy',
      attacker: this,
      strength: riposte ? Math.min(1, this.attackDef.strength + 0.35) : this.attackDef.strength,
      colors: riposte ? [COLORS.gold, COLORS.white] : [...w.colors],
    });
    this.feel.sfx.play('slash');
    if (riposte) {
      this.feel.burst(this.cx + this.facing * 10, this.cy, 8, {
        color: [COLORS.gold, COLORS.white], speed: 120, life: 0.25, drag: 4,
      });
    }
  }

  attackUpdate(dt: number): string | void {
    const attack = this.attackDef;
    if (!attack) return 'move';
    this.vx *= friction(attack.movementKeep, dt);
    const prog = this.fsm.t / this.attackDur;
    if (prog > attack.active[0] && prog < attack.active[1]) {
      const hits = this.strike?.apply(this.attackBox()) ?? [];
      // Pogo: a landed down-strike bounces the knight off her target and
      // refreshes the air — chain plunges Hollow Knight style.
      if (hits.length && attack.pogo && !this.onGround) {
        this.vy = -attack.pogo;
        this.airJumps = this.capabilities.modifier('airJumps', 0);
        this.dashCd = 0;
        this.squash = 1.35;
        this.feel.burst(this.cx, this.y + this.h, 8, {
          color: [COLORS.white, COLORS.gold], speed: 60, life: 0.3,
          angle: Math.PI / 2, spread: 2, drag: 3,
        });
        return 'move';
      }
    }
    // A plunge rides gravity down; the landing is the finish (with a thud).
    if (attack.aim === 'down' && this.onGround && this.fsm.t > 0.06) {
      this.feel.shake(0.2);
      this.feel.sfx.play('land');
      this.feel.burst(this.cx, this.y + this.h, 10, {
        color: [COLORS.steel, COLORS.white], speed: 70, life: 0.3,
        angle: -Math.PI / 2, spread: 2.6, drag: 4,
      });
      return 'move';
    }
    if (prog >= 1) {
      // Only grounded swings feed the combo chain.
      if (this.attackContext === 'ground') {
        const weapon = this.weapon;
        this.comboT = weaponTypeOf(weapon).comboWindow;
        this.comboWeaponId = weapon.id;
      }
      return 'move';
    }
  }

  beginDash(): void {
    const T = PLAYER_TUNING;
    // GALE DASH (tidecaller) shortens the wait between dashes.
    this.dashCd = T.dashCooldown * this.capabilities.modifier('dashCooldownScale', 1);
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
    // Dash attack: steel follows speed — attack mid-dash converts the
    // dash into a thrusting strike that keeps the momentum.
    if (this.atkBuf.consume() && weaponTypeOf(this.weapon).dashAttack) {
      this.attackContext = 'dash';
      return 'attack';
    }
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
    // Vertical aims center on the body; `forward` becomes the gap from
    // the feet (down) or the head (up).
    const aim = this.attackDef?.aim ?? 'forward';
    if (aim === 'down') {
      return { x: this.cx - hitbox.w / 2, y: this.y + this.h + hitbox.forward, w: hitbox.w, h: hitbox.h };
    }
    if (aim === 'up') {
      return { x: this.cx - hitbox.w / 2, y: this.y - hitbox.forward - hitbox.h, w: hitbox.w, h: hitbox.h };
    }
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
    this.rangedCd = Math.max(0, this.rangedCd - dt);
    this.parryCd = Math.max(0, this.parryCd - dt);
    this.riposteT = Math.max(0, this.riposteT - dt);
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

    // Water: how deep the body sits decides which physics rules apply.
    const sub = this.collision.submersion?.(this) ?? 0;
    const swimming = sub > 0.2 && !this.fsm.is('dead');

    // Gravity + jump physics (dash overrides velocity; the dead still fall).
    if (!this.fsm.is('dash')) {
      applyGravity(this, dt);
      if (swimming) {
        // The mechanism (buoyancy, ascend/dive, drag, caps) lives in the
        // engine; here we supply the tuning. Sink slowly by default, hold
        // jump to rise, hold down to dive; DEEP LUNGS boosts stroke and
        // cruise. The breach below is game feel, so it stays.
        const boost = 1 + this.capabilities.modifier('swimBoost', 0);
        swim(this, dt, sub, { ascend: this.input.held('jump'), dive: this.input.held('down') }, {
          buoyancy: SWIM.buoyancy,
          ascendAccel: SWIM.swimUp * boost,
          diveAccel: SWIM.dive,
          dragX: SWIM.dragX / boost,
          dragY: SWIM.dragY,
          maxRise: SWIM.maxRise * boost,
          driftSink: SWIM.driftSink,
          maxSink: SWIM.maxSink * boost,
          maxSpeedX: SWIM.swimSpeed * boost,
        });
        // Breach: a jump *press* right at the surface bursts you clear into
        // a real jump; a press in deep water is absorbed (hold to rise).
        if (this.jumpBuf.active && !this.fsm.is('attack')) {
          this.jumpBuf.consume();
          if (sub < SWIM.breachDepth) {
            this.vy = -T.jumpSpeed * 0.85;
            this.squash = 1.3;
            this.feel.sfx.play('jump');
            this.feel.burst(this.cx, this.y + this.h, 10, {
              color: ['#4d7bd6', COLORS.white], speed: 70, life: 0.35,
              angle: -Math.PI / 2, spread: 2.2, drag: 3, grav: 300,
            });
          }
        }
      } else if (this.jumpBuf.active && this.coyote.active && !this.fsm.is('dead', 'attack')) {
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
      // (Not while swimming — strokes and breaches are fixed impulses.)
      if (!swimming && !this.fsm.is('dead') && !this.input.held('jump') && this.vy < -T.jumpCutSpeed) {
        this.vy = -T.jumpCutSpeed;
      }
    }
    // Entry splash: hitting the surface with speed reads as impact.
    this.submersion = sub;
    if (sub > 0.25 && !this.wasWet && this.vy > 60) {
      this.feel.sfx.play('splat');
      this.feel.burst(this.cx, this.y, 12, {
        color: ['#4d7bd6', '#9fd0ff', COLORS.white], speed: 80, life: 0.4,
        angle: -Math.PI / 2, spread: 2.4, drag: 3, grav: 320,
      });
      this.vy *= 0.45; // water catches the fall
    }
    this.wasWet = sub > 0.25;

    // Oxygen: the head is what breathes. Depletes underwater, refills
    // fast in air (surface or an air pocket), drowns a heart at a time.
    const headWet = (this.collision.submersion?.({ x: this.x, y: this.y, w: this.w, h: 5 }) ?? 0) > 0.5;
    if (headWet && this.hp > 0) {
      // DEEP LUNGS (skill tree) extends how long a breath lasts.
      this.air = Math.max(0, this.air - dt / (SWIM.airSeconds + this.capabilities.modifier('extraAirSeconds', 0)));
      if (chance(dt * 1.6)) {
        this.feel.particles.spawn({
          x: this.cx + this.facing * 3, y: this.y + 2,
          vy: -26, vx: rand(-6, 6), life: 0.8, size: 1, color: '#bfe0ff', drag: 0.5,
        });
      }
      if (this.air <= 0 && !this.godMode) {
        this.drownT -= dt;
        if (this.drownT <= 0) {
          this.drownT = SWIM.drownEvery;
          this.hp--;
          this.feel.flash(0.25, '#2b5aa8');
          this.feel.sfx.play('hurt');
          this.feel.shake(0.3);
          if (this.hp <= 0) this.die();
        }
      }
    } else {
      this.air = Math.min(1, this.air + dt / SWIM.refillSeconds);
      this.drownT = SWIM.drownEvery;
    }

    const fallSpeed = this.vy;
    moveAndCollide(this, dt, this.collision);

    // Hazard tiles (spikes): a heart and a launch clear of the danger.
    // Dashing skims across; i-frames blink through.
    const hazard = this.collision.hazardAt?.(this) ?? 0;
    if (hazard > 0 && this.invulnT <= 0 && !this.godMode && !this.fsm.is('dead', 'dash')) {
      this.hp -= hazard;
      this.invulnT = 1.2;
      this.vy = -220;
      this.vx = -this.facing * 60;
      this.squash = 0.6;
      this.feel.sfx.play('hurt');
      this.feel.flash(0.2, COLORS.red);
      this.feel.shake(0.3);
      this.feel.burst(this.cx, this.y + this.h, 10, {
        color: [COLORS.red, COLORS.steel], speed: 80, life: 0.35, drag: 3,
      });
      this.game.events.emit('playerHurt', { hp: this.hp });
      if (this.hp <= 0) this.die();
    }

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

    if (this.fsm.is('parry')) {
      // A braced guard: weight settled back, blade shoulder forward.
      const k = clamp(1 - this.fsm.t / (PLAYER_TUNING.parryWindow + PLAYER_TUNING.parryRecovery), 0, 1);
      return { shear: -f * 0.18 * k, ox: -f * 1.5 * k, oy: 0, sx: 1, sy: 1 };
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
        charge: this.fsm.is('draw') ? this.charge.progress : undefined,
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

    // Guard flash: a bright crescent in front while the parry window is
    // open — the readable "now" of the deflect.
    if (this.fsm.is('parry') && this.parrying) {
      const gx = cx + this.facing * 7;
      const gy = by - dh * 0.5;
      g.save();
      g.globalAlpha = 0.5 + 0.3 * Math.sin(this.animT * 40);
      g.strokeStyle = COLORS.white;
      g.lineWidth = 1.4;
      g.beginPath();
      g.arc(gx, gy, 7, this.facing === 1 ? -1.1 : Math.PI + 1.1, this.facing === 1 ? 1.1 : Math.PI - 1.1);
      g.stroke();
      g.globalAlpha = 1;
      g.restore();
    }
    // Riposte charge: a small gold spark orbiting the blade hand.
    if (this.riposteT > 0 && !this.fsm.is('parry')) {
      const a = this.animT * 8;
      g.fillStyle = COLORS.gold;
      g.fillRect(Math.round(cx + this.facing * 6 + Math.cos(a) * 3), Math.round(by - dh * 0.55 + Math.sin(a) * 3), 1.5, 1.5);
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
  draw: {
    enter: (p) => p.beginDraw(),
    update: (p, dt) => p.drawUpdate(dt),
  },
  parry: {
    enter: (p) => p.beginParry(),
    update: (p, dt) => p.parryUpdate(dt),
    exit: (p) => { p.parrying = false; },
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
