import { FSM, rand, pick, frameAt, ballisticVelocity, t } from '@engine/index';
import { defineMonster, Monster } from './monster';
import { SLIME1, SLIME2, TEXEL, KNIGHT_ANIMS, baseKnight } from '../content/sprites';
import { tintOf, whiteOf } from '@engine/index';
import { COLORS } from '../content/palette';
import { shootBullet, muzzleFlash, BULLET_GRAVITY } from '../content/ballistics';
import type { Player } from './player';

/** Lob a sticky slime ball: no damage, applies the slow on hit. */
function throwStickyBall(b: Monster): void {
  const p = b.player;
  const dx = p ? p.cx - b.cx : 100;
  b.game.combat.shoot(
    {
      x: b.cx,
      y: b.y + 6,
      vx: dx * rand(0.9, 1.3),
      vy: rand(-240, -180),
      w: 5,
      h: 5,
      life: 3,
      gravity: 420,
      strike: {
        damage: 0, // it slows; it doesn't wound
        targets: 'player',
        attacker: b,
        strength: 0.25,
        knockback: 40,
        popY: 0,
        colors: [COLORS.green, COLORS.greenLight],
      },
      onHit(t) {
        (t as Player).statuses?.apply('sticky');
        b.game.feel.sfx.play('splat');
      },
      draw(g, pr) {
        g.fillStyle = Math.floor(pr.t * 16) % 2 ? COLORS.green : COLORS.greenLight;
        g.fillRect(Math.round(pr.x - 2), Math.round(pr.y - 2), 5, 5);
        // dripping trail
        if (Math.floor(pr.t * 30) % 3 === 0) {
          b.game.feel.particles.spawn({
            x: pr.x, y: pr.y, vy: 20, life: 0.3, size: 1, color: COLORS.green, drag: 1,
          });
        }
      },
      onExpire(pr) {
        b.game.feel.burst(pr.x, pr.y, 5, { color: COLORS.green, speed: 50, life: 0.25, drag: 3 });
      },
    },
    b.collision,
  );
  b.game.feel.sfx.play('slash');
}

/**
 * THE SLIME KING — the proof that bosses are just monsters with a state
 * machine. Phase 1 alternates chasing hops with a telegraphed slam that
 * sends a ground shockwave. Below half health he goes enraged: faster,
 * spits arcing globs, and summons minions. All damage flows through
 * strikes/projectiles, so every attack carries the standard feedback.
 */

const SCALE_X = 42 / 12;
const SCALE_Y = 30 / 7;

function enraged(m: Monster): boolean {
  return m.hp <= m.maxHp / 2;
}

function makeFsm(m: Monster): FSM<Monster> {
  // States close over `fsm` for time-in-state; it's assigned before any update runs.
  const fsm: FSM<Monster> = new FSM<Monster>(m, {
    /** Sit, breathe, pick the next move. */
    idle: {
      enter(b) {
        b.state.wait = rand(0.7, 1.2) * (enraged(b) ? 0.6 : 1);
      },
      update(b) {
        b.vx *= 0.8;
        if (fsm.t < (b.state.wait as number)) return;
        const options = enraged(b)
          ? ['hop', 'slam', 'spit', 'summon']
          : ['hop', 'hop', 'slam', 'stickySpit'];
        return pick(options);
      },
    },

    /** Chasing hop toward the player. Contact damage does the work. */
    hop: {
      enter(b) {
        const p = b.player;
        const d = p && p.cx > b.cx ? 1 : -1;
        b.vy = -260;
        b.vx = d * (enraged(b) ? 130 : 95);
        b.state.landed = false;
      },
      update(b) {
        if (b.onGround && fsm.t > 0.2 && !(b.state.landed as boolean)) {
          b.state.landed = true;
          b.game.feel.shake(0.3);
          b.game.feel.sfx.play('land');
          b.game.feel.burst(b.cx, b.y + b.h, 10, {
            color: COLORS.navyLight, speed: 90, life: 0.35,
            angle: -Math.PI / 2, spread: 2.6, drag: 3,
          });
          return 'idle';
        }
      },
    },

    /** Telegraphed slam: crouch, leap straight up, crash into a shockwave. */
    slam: {
      enter(b) {
        b.state.slamPhase = 0; // 0 telegraph, 1 airborne, 2 done
        b.vx = 0;
      },
      update(b) {
        const t = fsm.t;
        const phase = b.state.slamPhase as number;
        if (phase === 0) {
          // Telegraph: shiver in place — readable and dodgeable.
          if (Math.floor(t * 30) % 2) b.x += Math.sin(t * 60) * 0.5;
          if (t > 0.55) {
            b.state.slamPhase = 1;
            b.vy = -380;
            b.game.feel.sfx.play('jump');
          }
        } else if (phase === 1 && t > 0.7 && b.onGround) {
          b.state.slamPhase = 2;
          // THE slam: strong feedback + a grounded shockwave strike.
          b.game.feel.impact(b.cx, b.y + b.h, {
            strength: 0.85, colors: [COLORS.green, COLORS.gold], sfx: 'kill',
          });
          const strike = b.game.combat.strike({
            damage: 1,
            targets: 'player',
            attacker: b,
            strength: 0.6,
            knockback: 220,
            popY: -200,
            colors: [COLORS.green, COLORS.white],
          });
          strike.apply({ x: b.cx - 70, y: b.y + b.h - 10, w: 140, h: 12 });
          b.game.feel.burst(b.cx, b.y + b.h, 20, {
            color: [COLORS.green, COLORS.navyLight], speed: 160, life: 0.4,
            angle: Math.PI, spread: 0.6, drag: 2,
          });
          b.game.feel.burst(b.cx, b.y + b.h, 20, {
            color: [COLORS.green, COLORS.navyLight], speed: 160, life: 0.4,
            angle: 0, spread: 0.6, drag: 2,
          });
          return 'idle';
        }
      },
    },

    /** Phase 1: hock two sticky balls that slow but don't wound. */
    stickySpit: {
      enter(b) {
        b.state.spat = 0;
        b.vx = 0;
      },
      update(b) {
        const spat = b.state.spat as number;
        if (spat < 2 && fsm.t > 0.3 + spat * 0.3) {
          b.state.spat = spat + 1;
          throwStickyBall(b);
        }
        if (fsm.t > 1.1) return 'idle';
      },
    },

    /** Enraged: spit three arcing globs at the player (and they stick). */
    spit: {
      enter(b) {
        b.state.spat = 0;
      },
      update(b) {
        const spat = b.state.spat as number;
        if (spat < 3 && fsm.t > 0.25 + spat * 0.22) {
          b.state.spat = spat + 1;
          const p = b.player;
          const dx = p ? p.cx - b.cx : 100;
          b.game.combat.shoot(
            {
              x: b.cx, y: b.y + 4,
              vx: dx * rand(0.8, 1.3), vy: rand(-260, -180),
              w: 5, h: 5, life: 3, gravity: 420,
              strike: {
                damage: 1, targets: 'player', attacker: b,
                strength: 0.5, colors: [COLORS.green, COLORS.white],
              },
              onHit(t) {
                (t as Player).statuses?.apply('sticky');
              },
              draw(g, pr) {
                g.fillStyle = Math.floor(pr.t * 20) % 2 ? COLORS.green : COLORS.greenLight;
                g.fillRect(Math.round(pr.x - 2), Math.round(pr.y - 2), 5, 5);
              },
              onExpire(pr) {
                b.game.feel.burst(pr.x, pr.y, 5, {
                  color: COLORS.green, speed: 60, life: 0.25, drag: 3,
                });
              },
            },
            b.collision,
          );
          b.game.feel.sfx.play('slash');
        }
        if (fsm.t > 1.2) return 'idle';
      },
    },

    /** Enraged: call up to two minions (capped by live enemy count). */
    summon: {
      update(b) {
        if (fsm.t < 0.4) return;
        const minions = b.world.actors('enemy').length - 1;
        if (minions < 4) {
          for (let i = 0; i < 2; i++) {
            const x = b.cx + (i === 0 ? -30 : 30);
            const m = b.world.spawn(new Monster('slime', b.game, b.collision, x, b.y));
            b.game.feel.burst(m.cx, m.cy, 10, { color: m.def.colors, speed: 70, life: 0.35, drag: 3 });
          }
          b.game.feel.sfx.play('wave');
        }
        return 'idle';
      },
    },
  }, 'idle');
  return fsm;
}

defineMonster('slime-king', {
  hp: 45,
  damage: 1,
  w: 42,
  h: 30,
  // His sprite is a rounded blob: brushing the empty AABB corners
  // shouldn't hurt. Player attacks still test the full-size hurtbox.
  contactInset: 5,
  onPlayerContact(m, player) {
    if ((m.state.swallowCd as number ?? 0) > 0) return false;
    player.swallowBy(m);
    return true;
  },
  swallow: {
    status: 'devoured',
    colors: [COLORS.green, COLORS.white],
    onEnter(m) {
      m.state.victim = true;
      m.state.biteT = 1.0;
      m.vx = 0;
      m.vy = 0;
    },
    onRelease(m) {
      m.state.victim = false;
      m.state.swallowCd = 4.0;
    },
    drawPlayerOverlay(g, _m, _player, w, h) {
      g.save();
      g.globalAlpha = 0.45;
      g.fillStyle = COLORS.green;
      g.beginPath();
      g.arc(0, -h / 2, Math.max(w, h) * 0.65, 0, Math.PI * 2);
      g.fill();
      g.restore();
    },
  },
  score: 5000,
  mass: 6,
  boss: true,
  displayName: 'THE SLIME KING',
  colors: [COLORS.green, COLORS.gold, COLORS.greenLight],
  drops: [
    { id: 'coin', chance: 1 },
    { id: 'coin', chance: 1 },
    { id: 'coin', chance: 1 },
    { id: 'potion', chance: 1 },
    { id: 'mana-orb', chance: 1 },
  ],
  init(m) {
    m.state.fsm = makeFsm(m);
    m.state.wasEnraged = false;
    m.state.victim = false;
    m.state.biteT = 0;
    m.state.swallowCd = 0;
  },
  update(m, dt) {
    const fsm = m.state.fsm as FSM<Monster>;
    m.state.swallowCd = Math.max(0, (m.state.swallowCd as number ?? 0) - dt);
    
    const player = m.player as Player | undefined;

    // Digesting active check
    if (m.state.victim) {
      const held = player && player.swallowedBy === m && player.hp > 0;
      if (!held || !player) {
        m.state.victim = false;
        m.state.swallowCd = 4.0; // cooldown after escape
        return;
      }
      m.vx = 0;
      m.vy = 0;
      m.state.biteT = (m.state.biteT as number) - dt;
      if ((m.state.biteT as number) <= 0) {
        m.state.biteT = 1.0; // tick every 1.0s
        m.game.combat.hit(player, {
          damage: 1, targets: 'player', attacker: m,
          strength: 0.35, knockback: 0, popY: 0,
          colors: [COLORS.green, COLORS.white],
        });
      }
      return; // Freeze main FSM updates during digest
    }

    // Enrage transition: one-time announcement.
    if (enraged(m) && !(m.state.wasEnraged as boolean)) {
      m.state.wasEnraged = true;
      m.game.feel.slowmo(0.5, 0.4);
      m.game.feel.shake(0.6);
      m.game.feel.text(m.cx, m.y - 12, 'ENRAGED!', COLORS.red, 2);
      m.game.feel.sfx.play('hurt');
    }
    fsm.update(dt);
    if (!fsm.is('hop', 'slam')) m.vx *= Math.pow(0.05, dt);
  },
  draw(g, m) {
    const img = m.onGround ? SLIME1 : SLIME2;
    const digesting = m.state.victim as boolean;
    const bulge = digesting;
    const pulse = bulge ? 1 + Math.sin(m.animT * 6) * 0.08 : 1;
    const base = m.flashT > 0
      ? whiteOf(img)
      : (m.state.wasEnraged as boolean)
        ? tintOf(img, COLORS.red, 0.3)
        : tintOf(img, COLORS.gold, 0.18);
    g.save();
    g.translate(Math.round(m.x * 4) / 4, Math.round(m.y * 4) / 4);
    g.scale(SCALE_X * pulse, SCALE_Y * (bulge ? 1.12 : 1));
    g.drawImage(base, 0, 0, base.width / TEXEL, base.height / TEXEL);
    g.restore();
    // The crown.
    g.fillStyle = COLORS.gold;
    const cx = Math.round(m.cx);
    const crownBob = bulge ? Math.sin(m.animT * 6) * 1.5 : 0;
    g.fillRect(cx - 7, Math.round(m.y) - 4 + crownBob, 14, 3);
    g.fillRect(cx - 7, Math.round(m.y) - 7 + crownBob, 3, 3);
    g.fillRect(cx - 1, Math.round(m.y) - 8 + crownBob, 3, 4);
    g.fillRect(cx + 4, Math.round(m.y) - 7 + crownBob, 3, 3);
  },
});

/** Importing this module registers the boss. */
export function registerBosses(): void {}

/* ================ THE DUELIST ================ */

/**
 * THE DUELIST — the human boss: a fallen knight with a saber in one
 * hand and a flintlock in the other, rendered from the same animation
 * set as the player (tinted crimson — her dark mirror). The fight is
 * about movement: lunge combos up close, a backstep that flows into a
 * pistol shot, and the blur — an afterimage dash straight through you
 * with steel out. Below half health the tempo rises and an aerial
 * bullet volley joins the deck.
 */

const DUEL_TINT = '#8a1f35';
const DUEL_TINT_ENRAGED = '#c0243f';

interface Ghost { x: number; y: number; facing: 1 | -1; t: number }

function duelEnraged(m: Monster): boolean {
  return m.hp <= m.maxHp / 2;
}

/** Distance/direction to the player (falls back to facing forward). */
function toPlayer(m: Monster): { dx: number; dy: number; dist: number; dir: 1 | -1 } {
  const p = m.player;
  const dx = p ? p.cx - m.cx : m.facing * 100;
  const dy = p ? p.cy - m.cy : 0;
  return { dx, dy, dist: Math.hypot(dx, dy), dir: (Math.sign(dx) || 1) as 1 | -1 };
}

/** Leave an afterimage at the current pose. */
function ghost(m: Monster): void {
  const ghosts = m.state.ghosts as Ghost[];
  ghosts.push({ x: m.x, y: m.y, facing: m.facing, t: 0 });
  if (ghosts.length > 8) ghosts.shift();
}

/** One saber cut: hitbox in front, spark arc, sound. */
function saberStrike(m: Monster): void {
  const strike = m.game.combat.strike({
    damage: 1, targets: 'player', attacker: m,
    strength: 0.55, knockback: 150,
    colors: [DUEL_TINT_ENRAGED, COLORS.white],
  });
  const reach = 26;
  strike.apply({
    x: m.facing === 1 ? m.x + m.w - 4 : m.x - reach + 4,
    y: m.y + 2, w: reach, h: m.h - 4,
  });
  m.game.feel.sfx.play('slash');
}

/** A leveled pistol shot straight at the knight. */
function pistolShot(m: Monster): void {
  const { dx, dy } = toPlayer(m);
  const v = ballisticVelocity(dx, dy, 600, BULLET_GRAVITY) ?? { vx: m.facing * 600, vy: 0 };
  shootBullet(m.game, m.collision, {
    x: m.cx + m.facing * 8, y: m.cy - 2, vx: v.vx, vy: v.vy,
    damage: 1, targets: 'player', attacker: m,
  });
  muzzleFlash(m.game, m.cx + m.facing * 9, m.cy - 2, m.facing, 'bullet');
}

function makeDuelistFsm(m: Monster): FSM<Monster> {
  const fsm: FSM<Monster> = new FSM<Monster>(m, {
    /** Read the duel: pace, keep spacing, pick the next move. */
    idle: {
      enter(b) {
        b.state.wait = rand(0.55, 0.95) * (duelEnraged(b) ? 0.6 : 1);
      },
      update(b) {
        const { dist, dir } = toPlayer(b);
        b.facing = dir;
        // Footwork: drift toward a duelist's measure (~90px).
        if (dist > 120) b.vx += dir * 260 * 0.016;
        else if (dist < 60) b.vx -= dir * 200 * 0.016;
        else b.vx *= 0.82;
        b.vx = Math.max(-90, Math.min(90, b.vx));
        if (fsm.t < (b.state.wait as number)) return;
        const deck = dist > 150
          ? ['pistol', 'blur', 'blur', 'approach']
          : dist < 80
            ? ['combo', 'combo', 'backstep', 'blur']
            : ['combo', 'pistol', 'blur', 'backstep'];
        if (duelEnraged(b)) deck.push('volley', 'volley');
        return pick(deck);
      },
    },

    /** Close the measure at a run, then open the combo. */
    approach: {
      update(b) {
        const { dist, dir } = toPlayer(b);
        b.facing = dir;
        b.vx = dir * 190;
        if (dist < 85) return 'combo';
        if (fsm.t > 1.1) return 'idle';
      },
    },

    /** Lunge combo: two cuts (three enraged), each with its own step-in. */
    combo: {
      enter(b) {
        b.state.swings = 0;
        b.state.struck = false;
      },
      update(b) {
        const swings = b.state.swings as number;
        const total = duelEnraged(b) ? 3 : 2;
        const tSwing = fsm.t - swings * 0.3;
        if (tSwing < 0.1) {
          // Wind-up: plant and face the mark.
          const { dir } = toPlayer(b);
          if (!(b.state.struck as boolean)) b.facing = dir;
          b.vx *= 0.7;
        } else if (!(b.state.struck as boolean)) {
          // The lunge and the cut land together.
          b.state.struck = true;
          b.vx = b.facing * (duelEnraged(b) ? 300 : 240);
          saberStrike(b);
          b.game.feel.burst(b.cx + b.facing * 14, b.cy, 6, {
            color: [COLORS.white, DUEL_TINT_ENRAGED], speed: 90, life: 0.18,
            angle: b.facing === 1 ? 0 : Math.PI, spread: 1.1, drag: 5,
          });
        } else if (tSwing > 0.3) {
          b.state.swings = swings + 1;
          b.state.struck = false;
          if ((swings + 1) >= total) return 'idle';
        }
        if (b.state.struck) b.vx *= 0.88;
      },
    },

    /** Duelist's retreat: a sharp hop back that flows into the pistol. */
    backstep: {
      enter(b) {
        const { dir } = toPlayer(b);
        b.facing = dir;
        b.vy = -190;
        b.vx = -dir * 240;
        b.game.feel.sfx.play('dash');
      },
      update(b) {
        if (Math.floor(fsm.t * 30) % 2 === 0) ghost(b);
        if (b.onGround && fsm.t > 0.2) return 'pistol';
        if (fsm.t > 1) return 'pistol';
      },
    },

    /** Level the flintlock (the glint is the tell), then fire. */
    pistol: {
      enter(b) {
        b.state.fired = 0;
        const { dir } = toPlayer(b);
        b.facing = dir;
      },
      update(b) {
        b.vx *= 0.8;
        const fired = b.state.fired as number;
        const shots = duelEnraged(b) ? 2 : 1;
        if (fired < shots && fsm.t > 0.38 + fired * 0.28) {
          b.state.fired = fired + 1;
          pistolShot(b);
          b.vx -= b.facing * 70; // the kick
        }
        if (fsm.t > 0.5 + shots * 0.28) return 'idle';
      },
    },

    /** The blur: a crouch shimmer, then an afterimage dash THROUGH the
     * knight with the saber out — the cut travels with the dash. */
    blur: {
      enter(b) {
        b.state.blurPhase = 0;
        b.state.cutDone = false;
        const { dir } = toPlayer(b);
        b.facing = dir;
        b.vx = 0;
      },
      update(b) {
        const phase = b.state.blurPhase as number;
        if (phase === 0) {
          // Shimmer telegraph: the image splits before the dash.
          if (Math.floor(fsm.t * 40) % 3 === 0) ghost(b);
          if (fsm.t > 0.28) {
            b.state.blurPhase = 1;
            b.state.blurT = fsm.t;
            const { dir } = toPlayer(b);
            b.facing = dir;
            b.vx = dir * 540;
            b.game.feel.sfx.play('dash');
            b.game.feel.shake(0.15);
          }
        } else if (phase === 1) {
          ghost(b);
          b.vy = 0; // the blur rides a flat line
          // The traveling cut: a moving strike across the dash line.
          if (!(b.state.cutDone as boolean)) {
            const strike = b.game.combat.strike({
              damage: 1, targets: 'player', attacker: b,
              strength: 0.6, knockback: 120,
              colors: [DUEL_TINT_ENRAGED, COLORS.white],
            });
            const hits = strike.apply({ x: b.x - 6, y: b.y, w: b.w + 12, h: b.h });
            if (hits.length) b.state.cutDone = true;
          }
          if (fsm.t - (b.state.blurT as number) > 0.32) {
            b.vx *= 0.2;
            return 'idle';
          }
        }
      },
    },

    /** Enraged only: leap, hang in the air, and fan bullets down. */
    volley: {
      enter(b) {
        b.vy = -330;
        b.state.fired = 0;
        b.game.feel.sfx.play('jump');
      },
      update(b) {
        if (fsm.t < 0.45) return; // rising
        // The hang: gravity is beaten for a beat while the pistol works.
        if (fsm.t < 1.0) {
          b.vy = 0;
          b.vx *= 0.85;
          const fired = b.state.fired as number;
          if (fired < 4 && fsm.t > 0.5 + fired * 0.12) {
            b.state.fired = fired + 1;
            const { dx, dy } = toPlayer(b);
            const base = Math.atan2(dy, dx);
            const ang = base + (fired - 1.5) * 0.16; // the fan
            shootBullet(b.game, b.collision, {
              x: b.cx, y: b.cy, vx: Math.cos(ang) * 560, vy: Math.sin(ang) * 560,
              damage: 1, targets: 'player', attacker: b,
            });
            muzzleFlash(b.game, b.cx, b.cy, b.facing, 'bullet');
          }
          return;
        }
        if (b.onGround && fsm.t > 1.1) return 'idle';
        if (fsm.t > 2.5) return 'idle';
      },
    },
  }, 'idle');
  return fsm;
}

defineMonster('duelist', {
  hp: 30,
  damage: 1,
  w: baseKnight.hitbox.w,
  h: baseKnight.hitbox.h,
  // A fencer wounds with steel and powder, not by being brushed against.
  noContactDamage: true,
  score: 8000,
  mass: 1.4,
  boss: true,
  displayName: 'THE DUELIST',
  epilogue: 'duelist-fallen',
  colors: [DUEL_TINT, DUEL_TINT_ENRAGED, COLORS.steel],
  drops: [
    { id: 'flintlock', chance: 1 }, // her sidearm, yours now
    { id: 'coin', chance: 1 },
    { id: 'coin', chance: 1 },
    { id: 'potion', chance: 1 },
  ],
  xp: 220,
  init(m) {
    m.state.fsm = makeDuelistFsm(m);
    m.state.ghosts = [] as Ghost[];
    m.state.wasEnraged = false;
  },
  update(m, dt) {
    const fsm = m.state.fsm as FSM<Monster>;
    for (const g of m.state.ghosts as Ghost[]) g.t += dt;
    (m.state.ghosts as Ghost[]) = (m.state.ghosts as Ghost[]).filter((g) => g.t < 0.35);
    if (duelEnraged(m) && !(m.state.wasEnraged as boolean)) {
      m.state.wasEnraged = true;
      m.game.feel.slowmo(0.5, 0.4);
      m.game.feel.shake(0.5);
      m.game.feel.text(m.cx, m.y - 12, t('EN GARDE!'), COLORS.red, 2);
      m.game.feel.sfx.play('hurt');
    }
    fsm.update(dt);
  },
  draw(g, m) {
    const fsm = m.state.fsm as FSM<Monster>;
    const enragedNow = m.state.wasEnraged as boolean;
    const tint = enragedNow ? DUEL_TINT_ENRAGED : DUEL_TINT;

    // Afterimages first, faded and untinted-flash-free.
    const dw = baseKnight.w;
    const dh = baseKnight.h;
    for (const gh of m.state.ghosts as Ghost[]) {
      const set = gh.facing === 1 ? KNIGHT_ANIMS.right : KNIGHT_ANIMS.left;
      const img = tintOf(frameAt(set, 'run', 0), tint, 0.85);
      g.globalAlpha = Math.max(0, 0.4 - gh.t * 1.2);
      g.drawImage(img, Math.round(gh.x - baseKnight.hitbox.x), Math.round(gh.y - baseKnight.hitbox.y), dw, dh);
    }
    g.globalAlpha = 1;

    // The duelist herself: the knight's own frames, tinted crimson.
    let anim = 'idle';
    if (!m.onGround) anim = 'air';
    else if (Math.abs(m.vx) > 12 || fsm.is('combo', 'blur', 'approach')) anim = 'run';
    const set = m.facing === 1 ? KNIGHT_ANIMS.right : KNIGHT_ANIMS.left;
    let img = tintOf(frameAt(set, anim, m.animT), tint, 0.55);
    if (m.flashT > 0) img = whiteOf(img);
    g.drawImage(img, Math.round(m.x - baseKnight.hitbox.x), Math.round(m.y - baseKnight.hitbox.y), dw, dh);

    const f = m.facing;
    const hx = m.cx + f * 6;
    const hy = m.y + 12;
    // The saber: angle follows the current move.
    let angle = -0.5; // resting guard
    if (fsm.is('combo')) {
      const struck = m.state.struck as boolean;
      angle = struck ? 0.7 : -1.2; // wind-up high, follow-through low
    } else if (fsm.is('blur')) angle = 0.1; // leveled through the dash
    g.save();
    g.translate(hx, hy);
    g.rotate(f === 1 ? angle : Math.PI - angle);
    g.strokeStyle = m.flashT > 0 ? '#ffffff' : COLORS.steel;
    g.lineWidth = 1.6;
    g.beginPath();
    g.moveTo(0, 0);
    g.lineTo(15, 0);
    g.stroke();
    g.strokeStyle = 'rgba(255,255,255,0.85)';
    g.lineWidth = 0.7;
    g.beginPath();
    g.moveTo(3, -0.6);
    g.lineTo(14, -0.6);
    g.stroke();
    g.fillStyle = COLORS.gold;
    g.fillRect(-1.5, -1.5, 3, 3); // guard
    g.restore();

    // The pistol in the off hand — leveled and glinting while aiming.
    const aiming = fsm.is('pistol', 'volley');
    const gy = m.y + (aiming ? 14 : 18);
    g.fillStyle = m.flashT > 0 ? '#ffffff' : COLORS.steelDark;
    if (f === 1) g.fillRect(m.cx + 2, gy, 8, 1.5);
    else g.fillRect(m.cx - 10, gy, 8, 1.5);
    if (aiming && Math.floor(m.animT * 12) % 2 === 0) {
      g.fillStyle = COLORS.white;
      g.fillRect(m.cx + (f === 1 ? 9.5 : -11), gy - 0.5, 1.5, 1.5);
    }
  },
});
