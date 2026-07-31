import { FSM, rand, pick, frameAt, ballisticVelocity, carryBody, placeBody, t } from '@engine/index';
import { defineMonster, Monster } from './monster';
import { SLIME1, SLIME2, TEXEL, DUELIST_ANIMS, duelistSprite } from '../content/sprites';
import { tintOf, whiteOf, type Tilemap } from '@engine/index';
import { COLORS } from '../content/palette';
import { shootBullet, muzzleFlash, BULLET_GRAVITY } from '../content/ballistics';
import { drawDebris } from './gizmos';
import { Shockwave } from './shockwave';
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
          // Telegraph: shiver in place — drawn, not simulated.
          b.tremorX = Math.floor(t * 30) % 2 ? Math.sin(t * 60) * 0.5 : 0;
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
            damage: 30,
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
                damage: 14, targets: 'player', attacker: b,
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
  hp: 900,
  damage: 20,
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
  // Placeholder pairing: the design plan gives Impact Drop to a new first
  // boss (docs/gameplay-progression.md), which does not exist yet. Hanging
  // it on today's first mandatory boss makes the reward path real and
  // playable now; re-point this one line when that region is authored.
  grants: 'impact-drop',
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
          damage: 8, targets: 'player', attacker: m,
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
    damage: 18, targets: 'player', attacker: m,
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
    damage: 24, targets: 'player', attacker: m,
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
              damage: 30, targets: 'player', attacker: b,
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
              damage: 16, targets: 'player', attacker: b,
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
  hp: 600,
  damage: 18,
  w: duelistSprite.hitbox.w,
  h: duelistSprite.hitbox.h,
  // A fencer wounds with steel and powder, not by being brushed against.
  noContactDamage: true,
  score: 8000,
  mass: 1.4,
  boss: true,
  displayName: 'THE DUELIST',
  epilogue: 'duelist-fallen',
  // Placeholder pairing, as above — a second reward proves the catalog is
  // data and not a one-off.
  grants: 'air-step',
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

    const dw = duelistSprite.w;
    const dh = duelistSprite.h;
    const ox = duelistSprite.hitbox.x;
    const oy = duelistSprite.hitbox.y;

    // Afterimages first: her own run frame as fading crimson echoes.
    for (const gh of m.state.ghosts as Ghost[]) {
      const set = gh.facing === 1 ? DUELIST_ANIMS.right : DUELIST_ANIMS.left;
      const img = tintOf(frameAt(set, 'run', 0), DUEL_TINT_ENRAGED, 0.5);
      g.globalAlpha = Math.max(0, 0.4 - gh.t * 1.2);
      g.drawImage(img, Math.round(gh.x - ox), Math.round(gh.y - oy), dw, dh);
    }
    g.globalAlpha = 1;

    // The duelist herself, drawn from her own crimson-coat sprite.
    let anim = 'idle';
    if (!m.onGround) anim = 'air';
    else if (Math.abs(m.vx) > 12 || fsm.is('combo', 'blur', 'approach')) anim = 'run';
    const set = m.facing === 1 ? DUELIST_ANIMS.right : DUELIST_ANIMS.left;
    let img = frameAt(set, anim, m.animT);
    if (m.flashT > 0) img = whiteOf(img);
    else if (enragedNow) img = tintOf(img, DUEL_TINT_ENRAGED, 0.25); // hotter crimson enraged
    g.drawImage(img, Math.round(m.x - ox), Math.round(m.y - oy), dw, dh);

    const f = m.facing;
    // The saber springs from her leading (sword) hand — anchored to the
    // sprite's forward reach, ~2px above the coat's waist line.
    const hx = m.cx + f * 5;
    const hy = m.y + 9;
    // Angle follows the current move.
    let angle = -0.45; // resting guard, tip up
    if (fsm.is('combo')) {
      const struck = m.state.struck as boolean;
      angle = struck ? 0.55 : -1.15; // wind-up high, follow-through low
    } else if (fsm.is('blur')) angle = 0.05; // leveled through the dash
    else if (fsm.is('air')) angle = -0.9;
    g.save();
    g.translate(hx, hy);
    g.rotate(f === 1 ? angle : Math.PI - angle);
    // Gold hilt + guard, then a tapering steel blade.
    g.fillStyle = m.flashT > 0 ? '#ffffff' : COLORS.gold;
    g.fillRect(-1, -1, 2, 2); // pommel/guard, compact
    g.strokeStyle = m.flashT > 0 ? '#ffffff' : COLORS.steel;
    g.lineWidth = 1.1;
    g.beginPath();
    g.moveTo(1, 0);
    g.lineTo(12, 0);
    g.stroke();
    g.strokeStyle = 'rgba(255,255,255,0.85)'; // fuller glint
    g.lineWidth = 0.5;
    g.beginPath();
    g.moveTo(3, -0.5);
    g.lineTo(11, -0.5);
    g.stroke();
    g.restore();

    // The flintlock in the off hand — leveled and glinting while aiming.
    const aiming = fsm.is('pistol', 'volley');
    const gy = m.y + (aiming ? 11 : 14);
    g.fillStyle = m.flashT > 0 ? '#ffffff' : COLORS.steelDark;
    if (f === 1) g.fillRect(m.cx + 2, gy, 7, 1.5);
    else g.fillRect(m.cx - 9, gy, 7, 1.5);
    if (aiming && Math.floor(m.animT * 12) % 2 === 0) {
      g.fillStyle = COLORS.white;
      g.fillRect(m.cx + (f === 1 ? 8.5 : -10), gy - 0.5, 1.5, 1.5);
    }
  },
});

/* ==================== VISE, THE WALL BEAST ==================== */

/**
 * The Riven's keeper, and the fight that argues for Wall Grip.
 *
 * Vise never touches the floor. It owns both walls of the shaft while
 * the player rents four crumbling platforms, and the whole fight is the
 * ache of watching a creature do the thing you cannot do yet. You hurt
 * it by unmaking that grip: **its health is its limbs**. Four sever
 * before it loses the wall, each one tearing free with a crack, each one
 * dropping it lower and making it faster — the progress bar is a body
 * coming apart, and the danger curve rises with it.
 *
 * There is no stationary punish window here. Maul taught bait → stagger;
 * Vise damages IN MOTION, so the reachable limbs are always the ones
 * nearest platform level while it crawls (see docs/world-design.md, "one
 * punish grammar per Keeper").
 */

const VISE_LIMB_HP = 130;
/** Severing this many costs it the wall — six limbs, four must go. */
const VISE_SEVERS = 4;
const VISE_BODY = '#2f4a72';
const VISE_LIMB = '#8fb6d6';

/** How many limbs are gone, from damage taken. */
function severed(m: Monster): number {
  return Math.min(VISE_SEVERS, Math.floor((m.maxHp - m.hp) / VISE_LIMB_HP));
}

/** Inner face of the wall on `side`, found by probing the room once. */
function wallFace(m: Monster, side: -1 | 1): number {
  const step = 8;
  for (let d = 0; d < 900; d += step) {
    const x = side < 0 ? m.cx - d : m.cx + d;
    const probe = { x: x - step / 2, y: m.cy - 4, w: step, h: 8 };
    for (const s of m.collision.solidsNear(probe)) {
      if (s.oneWay) continue;
      if (probe.x < s.x + s.w && probe.x + probe.w > s.x && probe.y < s.y + s.h && probe.y + probe.h > s.y) {
        return side < 0 ? s.x + s.w : s.x;
      }
    }
  }
  return side < 0 ? 0 : m.cx + 200;
}

/**
 * Press the body toward its wall (it is always holding on). The press is
 * a velocity and the mover does the parking — flush at the face it
 * measured, or against whatever intervenes. Setting `m.x` to the face
 * directly was the old way, and assignment is not physics: nothing
 * checked the parking spot against the world it was parking in.
 */
function hugWall(m: Monster, dt: number): void {
  const side = m.state.side as -1 | 1;
  const face = side < 0 ? (m.state.leftX as number) : (m.state.rightX as number);
  const target = side < 0 ? face : face - m.w;
  m.vx = (target - m.x) / dt;
}

/** Drop debris down one column — the hammering it does to its own wall. */
function viseDebris(m: Monster, x: number): void {
  m.game.combat.shoot(
    {
      x, y: m.cy - 40, vx: 0, vy: 90,
      w: 9, h: 9, life: 4, gravity: 620,
      strike: {
        damage: 16, targets: 'player', attacker: m,
        strength: 0.4, knockback: 40, popY: 0,
        colors: ['#5b7fa8', '#22304f'],
      },
      draw(g, p) {
        drawDebris(g, p.x, p.y, p.t);
      },
      onExpire(p) {
        m.game.feel.burst(p.x, p.y, 5, { color: ['#5b7fa8', '#22304f'], speed: 60, life: 0.3, drag: 4 });
      },
    },
    m.collision,
  );
}

function makeViseFsm(m: Monster): FSM<Monster> {
  const fsm: FSM<Monster> = new FSM<Monster>(m, {
    /**
     * Crawling the wall — and the only place damage happens. It tracks
     * the knight's height, so the limbs in reach are always the ones
     * nearest platform level: come to the wall's edge and take them.
     */
    traverse: {
      enter(b) {
        b.state.pick = rand(1.1, 1.9) * (1 - severed(b) * 0.12);
      },
      update(b, dt) {
        hugWall(b, dt); // the press IS this state's vx
        const p = b.player;
        // Climb toward the knight, faster with every limb it has lost.
        const speed = 40 + severed(b) * 16;
        const goal = p ? p.cy - 6 : b.cy;
        b.vy = Math.abs(goal - b.cy) < 6 ? 0 : Math.sign(goal - b.cy) * speed;
        if (fsm.t < (b.state.pick as number)) return;
        const heavy = severed(b) >= 3;
        return pick(heavy
          ? ['lunge', 'lunge', 'pinSlam', 'rockfall']
          : ['lunge', 'rockfall', 'pinSlam', 'lunge']);
      },
    },

    /**
     * Coil and spring flat across the shaft to the far wall. The coil is
     * the tell; with three limbs gone it feints once first — the same
     * shape, half the commitment.
     */
    lunge: {
      enter(b) {
        b.state.feinted = false;
        b.state.flying = false;
        b.vy = 0;
        b.vx = 0;
      },
      update(b, dt) {
        const heavy = severed(b) >= 3;
        if (!(b.state.flying as boolean)) {
          hugWall(b, dt);
          // Coil: limbs bunch, and the body shivers back against the wall.
          const coil = heavy && !(b.state.feinted as boolean) ? 0.34 : 0.5;
          if (fsm.t > coil) {
            if (heavy && !(b.state.feinted as boolean)) {
              // The feint: it uncoils a hand's width and re-coils.
              b.state.feinted = true;
              b.game.feel.sfx.play('step');
              return;
            }
            b.state.flying = true;
            b.vx = -(b.state.side as number) * 340;
            b.vy = 0;
            b.game.feel.sfx.play('jump');
            b.game.feel.shake(0.2);
          }
          return;
        }
        // In flight: a flat spring, until the far wall catches it.
        const side = b.state.side as -1 | 1;
        const far = side < 0 ? (b.state.rightX as number) : (b.state.leftX as number);
        const arrived = side < 0 ? b.x + b.w >= far : b.x <= far;
        if (arrived || fsm.t > 1.6) {
          b.state.side = -side;
          hugWall(b, dt);
          b.game.feel.impact(b.cx, b.cy, { strength: 0.5, colors: [VISE_LIMB, VISE_BODY], sfx: 'land' });
          return 'traverse';
        }
      },
    },

    /**
     * Hammers its own wall; two columns come down. The third column is
     * the answer — the debris is marked before it falls.
     */
    rockfall: {
      enter(b) {
        b.state.dropped = 0;
        b.vy = 0;
        const p = b.player;
        // Two columns bracketing the knight: the gap between is the room.
        const at = p ? p.cx : b.cx;
        b.state.colA = at - 46;
        b.state.colB = at + 46;
      },
      update(b, dt) {
        hugWall(b, dt);
        const dropped = b.state.dropped as number;
        // Telegraph: dust off both columns before anything falls.
        if (fsm.t < 0.5) {
          if (Math.floor(fsm.t * 30) % 4 === 0) {
            for (const x of [b.state.colA as number, b.state.colB as number]) {
              b.game.feel.particles.spawn({
                x, y: b.cy - 36, vy: 50, life: 0.3, size: 1, color: '#6d86a8', drag: 1,
              });
            }
          }
          return;
        }
        if (dropped < 3 && fsm.t > 0.5 + dropped * 0.38) {
          b.state.dropped = dropped + 1;
          viseDebris(b, b.state.colA as number);
          viseDebris(b, b.state.colB as number);
          b.game.feel.shake(0.25);
          b.game.feel.sfx.play('step');
        }
        if (fsm.t > 1.9) return 'traverse';
      },
    },

    /**
     * Slams both walls at once. The shudder runs through everything
     * bolted to them — which is every platform in the arena. Be in the
     * air when it lands: the floor is what carries the blow.
     */
    pinSlam: {
      enter(b) {
        b.state.struck = false;
        b.vy = 0;
      },
      update(b, dt) {
        hugWall(b, dt);
        // Telegraph: it hauls itself flat to the wall and trembles —
        // drawn, not simulated.
        if (fsm.t < 0.6) {
          b.tremorY = Math.floor(fsm.t * 40) % 2 ? Math.sin(fsm.t * 70) * 0.6 : 0;
          return;
        }
        if (!(b.state.struck as boolean)) {
          b.state.struck = true;
          b.game.feel.impact(b.cx, b.cy, { strength: 0.9, colors: [VISE_LIMB, COLORS.white], sfx: 'kill' });
          b.game.feel.shake(0.7);
          const strike = b.game.combat.strike({
            damage: 26, targets: 'player', attacker: b,
            strength: 0.6, knockback: 120, popY: -140,
            colors: [VISE_LIMB, COLORS.white],
          });
          // The blow travels through the platforms, not the air: only
          // whoever is STANDING on the arena takes it.
          for (const p of b.world.actors('player')) {
            if (p.onGround) strike.apply(p);
          }
          for (let i = 0; i < 2; i++) {
            b.game.feel.burst(b.cx, b.cy, 12, {
              color: [VISE_LIMB, VISE_BODY], speed: 150, life: 0.4,
              angle: i === 0 ? 0 : Math.PI, spread: 0.7, drag: 2,
            });
          }
        }
        if (fsm.t > 1.1) return 'traverse';
      },
    },
  }, 'traverse');
  return fsm;
}

defineMonster('vise', {
  hp: VISE_LIMB_HP * VISE_SEVERS,
  damage: 22,
  w: 30,
  h: 26,
  score: 9000,
  boss: true,
  flies: true, // it is always holding the wall; the floor is not its business
  displayName: 'VISE, THE WALL BEAST',
  epilogue: 'vise-fallen',
  grants: 'wall-grip',
  colors: [VISE_BODY, VISE_LIMB, COLORS.white],
  drops: [
    { id: 'coin', chance: 1 },
    { id: 'coin', chance: 1 },
    { id: 'potion', chance: 1 },
    { id: 'mana-orb', chance: 1 },
  ],
  xp: 260,
  init(m) {
    m.state.side = -1;
    m.state.leftX = wallFace(m, -1);
    m.state.rightX = wallFace(m, 1);
    m.state.shown = 0; // limbs already torn off on screen
    m.state.fsm = makeViseFsm(m);
    // Spawn-time positioning is PLACEMENT, not a press: put it at the
    // wall it will spend the fight holding, resolved like any placement.
    const side = m.state.side as -1 | 1;
    const face = m.state.leftX as number;
    placeBody(m, side < 0 ? face : face - m.w, m.y, m.collision);
  },
  update(m, dt) {
    // A limb tears free: the fight's whole progress display, and the
    // moment the danger rises. It re-grips lower — nearer the platforms,
    // nearer you — and everything it does gets quicker.
    const gone = severed(m);
    if (gone > (m.state.shown as number)) {
      m.state.shown = gone;
      m.game.feel.slowmo(0.45, 0.3);
      m.game.feel.shake(0.6);
      m.game.feel.sfx.play('kill');
      m.game.feel.text(m.cx, m.y - 10, t('LIMB SEVERED'), VISE_LIMB, 2);
      m.game.feel.burst(m.cx, m.cy, 18, {
        color: [VISE_LIMB, VISE_BODY], speed: 130, life: 0.5, drag: 2.5,
      });
      // It slips down the wall, closer to the platforms — a swept lurch,
      // so a floor or a platform under it stops the slip like it would
      // stop anything else.
      carryBody(m, 0, 14, m.collision);
    }
    (m.state.fsm as FSM<Monster>).update(dt);
  },
  draw(g, m) {
    const side = (m.state.side as number) ?? -1;
    const fsm = m.state.fsm as FSM<Monster> | undefined;
    const coiling = !!fsm && fsm.is('lunge') && !(m.state.flying as boolean);
    const left = Math.round(m.x);
    const top = Math.round(m.y);
    const alive = VISE_SEVERS + 2 - severed(m); // six limbs, minus what's gone

    // Limbs first: they are the health bar, so they read before the body.
    for (let i = 0; i < alive; i++) {
      const row = i % 3;
      const back = i >= 3;
      const ly = top + 3 + row * 8;
      const wave = Math.sin(m.animT * (coiling ? 12 : 4) + i * 1.3);
      const reach = coiling ? 6 + wave * 2 : 12 + wave * 4;
      g.fillStyle = m.flashT > 0 ? COLORS.white : (back ? VISE_BODY : VISE_LIMB);
      // Hooked into the wall behind it, splayed into the shaft in front.
      if (side < 0) {
        g.fillRect(left - 4, ly, 6, 3);
        if (!back) g.fillRect(left + m.w - 2, ly + 1, reach, 3);
      } else {
        g.fillRect(left + m.w - 2, ly, 6, 3);
        if (!back) g.fillRect(left + 2 - reach, ly + 1, reach, 3);
      }
    }
    // Body: a flat carapace pressed to the stone.
    g.fillStyle = m.flashT > 0 ? COLORS.white : VISE_BODY;
    g.fillRect(left + 2, top, m.w - 4, m.h);
    g.fillStyle = m.flashT > 0 ? COLORS.white : '#22304f';
    g.fillRect(left + 4, top + 3, m.w - 8, m.h - 6);
    // Eyes down the spine, gold and unbothered.
    g.fillStyle = m.flashT > 0 ? COLORS.white : COLORS.gold;
    for (let i = 0; i < 3; i++) {
      g.fillRect(left + (side < 0 ? m.w - 9 : 5), top + 5 + i * 7, 3, 2);
    }
  },
});

/**
 * A nest cluster: wall matter that drips wallcrawlers until it is
 * smashed. Clearing one is a CHOICE — fewer adds, or more time on the
 * limbs — which is the only resource decision the fight asks for.
 */
defineMonster('vise-nest', {
  hp: 90,
  damage: 0,
  noContactDamage: true,
  w: 16, h: 20,
  score: 300,
  flies: true, // it is part of the wall
  colors: ['#3f5f85', '#8fb6d6'],
  init(m) {
    m.state.spawnT = rand(3, 5);
  },
  update(m, dt) {
    m.vx = 0;
    m.vy = 0;
    m.state.spawnT = (m.state.spawnT as number) - dt;
    if ((m.state.spawnT as number) > 0) return;
    m.state.spawnT = rand(5.5, 7.5);
    // Never flood the shaft: the fight is the boss, not the swarm.
    const crawlers = m.world.actors('enemy').filter((e) => e instanceof Monster && e.type === 'wallcrawler').length;
    if (crawlers >= 3) return;
    const c = m.world.spawn(new Monster('wallcrawler', m.game, m.collision, m.cx - 7, m.y + m.h));
    m.game.feel.burst(c.cx, c.cy, 8, { color: ['#8fb6d6'], speed: 60, life: 0.3, drag: 3 });
    m.game.feel.sfx.play('splat');
  },
  draw(g, m) {
    const x = Math.round(m.x);
    const y = Math.round(m.y);
    g.fillStyle = m.flashT > 0 ? COLORS.white : '#2b4467';
    g.fillRect(x, y, m.w, m.h);
    g.fillStyle = m.flashT > 0 ? COLORS.white : '#3f5f85';
    for (let i = 0; i < 5; i++) {
      const cx = x + 2 + ((i * 5) % (m.w - 4));
      const cy = y + 2 + ((i * 7) % (m.h - 5));
      g.fillRect(cx, cy, 4, 4);
    }
    // Wet cells that pulse when something inside is nearly ready.
    const ready = (m.state.spawnT as number) < 1.2;
    g.fillStyle = m.flashT > 0 ? COLORS.white : (ready ? COLORS.gold : '#8fb6d6');
    for (let i = 0; i < 3; i++) {
      const p = Math.sin(m.animT * (ready ? 9 : 3) + i) * 0.5 + 0.5;
      g.fillRect(x + 3 + i * 5, y + 4 + Math.round(p * 9), 2, 2);
    }
  },
});

/* ==================== MOURN, THE BELL BELOW ==================== */

/**
 * The Keeper of the voice, and the fight that argues for Shockwave.
 *
 * Mourn is blind. It hunts by what the stone tells it, which turns the
 * arena into an instrument the player plays: **you author your own
 * openings by choosing where sound happens, then strike from the
 * silence.** Every other Keeper hands you a window — Maul staggers,
 * Bellwether's beat comes round, Vise crawls past. Mourn hands you
 * nothing and lets you make one.
 *
 * The damage model IS the fiction. Its attention pins to the last loud
 * thing it felt, and the flank facing away from that noise hangs open.
 * Hit the braced side and you may as well be hitting the floor.
 *
 * Its health is its grief made solid — four deadstone knots along the
 * spine (Vise's component-health pattern). The fourth ends it: Mourn is
 * *beaten, not butchered*, which is what the Keepers' story needs the
 * fight to say.
 */
const MOURN_KNOT_HP = 120;
/** Four knots of grief; shattering the last rings it clean. */
const MOURN_KNOTS = 4;
const MOURN_BODY = '#3b3350';
const MOURN_KNOT = '#cfc4e8';
const MOURN_EAR = '#e8d98f';

/** How many spine-knots are gone, from damage taken. */
function shattered(m: Monster): number {
  return Math.min(MOURN_KNOTS, Math.floor((m.maxHp - m.hp) / MOURN_KNOT_HP));
}

/**
 * Where Mourn BELIEVES the knight is, and how sure it is.
 *
 * It only ever knows the last place the floor rang. Go quiet and the
 * belief goes stale exactly where you left it — that staleness is the
 * opening, which is why the ear is drawn dimmer as it decays.
 */
function attention(m: Monster): { x: number; sure: number } {
  const at = m.state.earAt as { x: number; y: number } | undefined;
  return { x: at?.x ?? m.cx, sure: (m.state.earSure as number) ?? 0 };
}

/** Which side its attention is pinned to: -1 left, +1 right. */
function earSide(m: Monster): -1 | 1 {
  return attention(m).x < m.cx ? -1 : 1;
}

/**
 * Listen. The only sense it has.
 *
 * It hears the LOUDEST knight, not the nearest — `m.player` answers
 * "who is closest", which is the wrong question for a blind thing. In
 * co-op that difference is the whole mechanic: a partner sprinting on
 * the far side of the arena must be able to pull its attention away
 * while you creep in from the quiet, and picking by distance would let a
 * silent knight standing nearer swallow the decoy entirely.
 */
function mournListen(m: Monster, dt: number): void {
  let loudest: Player | null = null;
  for (const a of m.world.actors('player')) {
    const p = a as Player;
    if (p.dead || p.noise <= 0.45 || !p.lastNoiseAt) continue;
    if (!loudest || p.noise > loudest.noise) loudest = p;
  }
  // While the chamber hums, footfalls are lost inside it (see `humming`):
  // the free approach the last knot is supposed to buy.
  if (loudest && !humming(m) && loudest.lastNoiseAt) {
    m.state.earAt = { x: loudest.lastNoiseAt.x, y: loudest.lastNoiseAt.y };
    m.state.earSure = 1;
  } else {
    // A knight who is still, airborne, or on deadstone tells it nothing,
    // and the old belief simply decays where it stands.
    m.state.earSure = Math.max(0, ((m.state.earSure as number) ?? 0) - dt * 0.5);
  }
  m.facing = earSide(m);
}

/**
 * Is the chamber ringing right now?
 *
 * On the last knot Mourn hums on a rhythm, and a hum loud enough to
 * shake the room is loud enough to hide a footstep in. The masked window
 * is the gap BETWEEN beats resolving — deliberately most of the cycle,
 * because the promise is "the brave get free approaches", and a promise
 * the code does not keep is worse than no promise.
 */
function humming(m: Monster): boolean {
  return (m.state.humMask as number ?? 0) > 0;
}

/** A toll: the knight's own verb, aimed the other way. */
function tollWave(m: Monster, dir: 1 | -1): void {
  m.game.world.spawn(new Shockwave(m.game, m.collision as Tilemap, m, dir, {
    targets: 'player',
    damage: 18 + shattered(m) * 4,
    range: 220,
    speed: 210,
    colors: [MOURN_KNOT, COLORS.white],
  }));
  m.game.feel.shake(0.35);
}

function makeMournFsm(m: Monster): FSM<Monster> {
  const fsm: FSM<Monster> = new FSM<Monster>(m, {
    /**
     * The resting state, and what the fight is about. It listens, turns
     * its head toward the last noise, and decides what to do about it.
     * Patience shortens as the knots go.
     */
    listen: {
      enter(b) {
        b.state.patience = rand(1.3, 2.2) * (1 - shattered(b) * 0.13);
        b.state.loudFor = 0;
      },
      update(b, dt) {
        mournListen(b, dt);
        b.vx = 0;
        const p = b.player as Player | undefined;
        // Sustained loudness on one span presses its ear to that surface —
        // the biggest opening in the fight, and one the player BUILT.
        if (p && p.noise > 0.8 && (b.state.earSure as number) >= 1) {
          b.state.loudFor = ((b.state.loudFor as number) ?? 0) + dt;
          if ((b.state.loudFor as number) > 0.9) return 'fixate';
        } else {
          b.state.loudFor = 0;
        }
        if (fsm.t < (b.state.patience as number)) return;
        const heavy = shattered(b) >= 2;
        return pick(heavy ? ['toll', 'pounce', 'toll', 'keen'] : ['toll', 'pounce', 'toll']);
      },
    },

    /**
     * Waves along the floor, both ways from its feet. The counter is the
     * room itself: leave the ground, or stand on deadstone, which carries
     * nothing — the same rule the knight's own Shockwave obeys.
     */
    toll: {
      enter(b) { b.state.tolled = false; },
      update(b, dt) {
        mournListen(b, dt);
        b.vx = 0;
        // Telegraph: it draws breath and the knots shiver.
        if (fsm.t < 0.55) {
          b.tremorY = Math.sin(fsm.t * 60) * 0.7;
          return;
        }
        if (!(b.state.tolled as boolean)) {
          b.state.tolled = true;
          tollWave(b, 1);
          tollWave(b, -1);
        }
        if (fsm.t > 1.25) return 'listen';
      },
    },

    /**
     * It leaps at the last place it heard and comes down hard. Bait it
     * and its own landing becomes your cover — and its next noise.
     */
    pounce: {
      enter(b) {
        b.state.launched = false;
        b.vx = 0;
      },
      update(b, dt) {
        if (fsm.t < 0.45) {
          mournListen(b, dt);
          b.tremorX = Math.sin(fsm.t * 70) * 0.6;
          return;
        }
        if (!(b.state.launched as boolean)) {
          b.state.launched = true;
          const dx = attention(b).x - b.cx;
          b.vx = Math.max(-260, Math.min(260, dx * 1.6));
          b.vy = -300;
          b.game.feel.sfx.play('jump');
        }
        // The landing IS the attack, and it rings the floor.
        if (b.onGround && fsm.t > 0.6) {
          b.game.feel.impact(b.cx, b.cy, {
            strength: 0.7, colors: [MOURN_KNOT, COLORS.white], sfx: 'land',
          });
          b.game.feel.shake(0.5);
          const strike = b.game.combat.strike({
            damage: 22, targets: 'player', attacker: b,
            strength: 0.6, knockback: 150, popY: -120,
            colors: [MOURN_KNOT, COLORS.white],
          });
          strike.apply({ x: b.x - 20, y: b.y, w: b.w + 40, h: b.h + 8 });
          return 'listen';
        }
        if (fsm.t > 2.4) return 'listen';
      },
    },

    /**
     * Ear pressed to a loud surface: deaf to everything else and WIDE
     * open, long enough to shatter a knot outright — provided you are no
     * longer standing on the thing that made the noise.
     */
    fixate: {
      enter(b) {
        b.state.loudFor = 0;
        b.vx = 0;
        b.game.feel.sfx.play('menuOpen');
      },
      update(b) {
        b.tremorY = Math.sin(b.animT * 8) * 0.4;
        if (fsm.t > 1.8) return 'listen';
      },
    },

    /** A standing cry brings the bats in — more noise, yours to steer. */
    keen: {
      enter(b) {
        b.state.called = false;
        b.vx = 0;
      },
      update(b, dt) {
        mournListen(b, dt);
        if (fsm.t < 0.5) {
          b.tremorX = Math.sin(fsm.t * 50) * 0.5;
          return;
        }
        if (!(b.state.called as boolean)) {
          b.state.called = true;
          b.game.feel.sfx.play('kill');
          // Call them into open air ABOVE it, not blindly out to the
          // sides: a ±26px offset is inside the wall whenever Mourn is
          // fighting near one. Placement still has the final say (a bat
          // with nowhere to go is stillborn rather than embedded), but
          // asking for a sane spot means it rarely has to exercise it.
          for (const dx of [-18, 18]) {
            const bat = new Monster('bat', b.game, b.collision, b.cx + dx, b.y - 26);
            if (!bat.dead) b.world.spawn(bat);
          }
        }
        if (fsm.t > 1.1) return 'listen';
      },
    },
  }, 'listen');
  return fsm;
}

defineMonster('mourn', {
  hp: MOURN_KNOT_HP * MOURN_KNOTS,
  damage: 20,
  w: 34,
  h: 28,
  score: 11000,
  boss: true,
  displayName: 'MOURN, THE BELL BELOW',
  epilogue: 'mourn-fallen',
  grants: 'shockwave',
  colors: [MOURN_BODY, MOURN_KNOT, COLORS.white],
  drops: [
    { id: 'coin', chance: 1 },
    { id: 'coin', chance: 1 },
    { id: 'potion', chance: 1 },
    { id: 'mana-orb', chance: 1 },
  ],
  xp: 300,
  /**
   * The damage model, in one rule: it is BRACED on the side its ear is
   * pinned to and open on the other. Strike from the noise and you are
   * hitting something that already knows where you are; strike from the
   * quiet and the blow lands whole.
   *
   * `fixate` is the payoff for authoring a loud decoy — ear to the stone,
   * open from every side.
   */
  mitigate(m, damage, opts) {
    const fsm = m.state.fsm as FSM<Monster> | undefined;
    if (fsm?.is('fixate')) return damage;
    const from = opts.attacker;
    if (!from) return damage;
    const side = from.cx < m.cx ? -1 : 1;
    return side === earSide(m) ? damage * 0.15 : damage;
  },
  /**
   * What a co-op guest needs to READ this fight: how sure the ear is, and
   * whether it is fixated. Both live in internal state a puppet never
   * simulates, and both are the safe-opening signal — without them the
   * second knight sees a dim ear forever and is playing blind against a
   * blind thing.
   */
  tell(m) {
    const fsm = m.state.fsm as FSM<Monster> | undefined;
    return [attention(m).sure, fsm?.is('fixate') ? 1 : 0];
  },
  readTell(m, [sure, fixated]) {
    m.state.earSure = sure;
    // The puppet has no FSM of its own worth trusting; the flag drives
    // the draw directly.
    m.state.remoteFixate = fixated === 1;
  },
  init(m) {
    m.state.earAt = { x: m.cx, y: m.cy };
    m.state.earSure = 0;
    m.state.shown = 0;
    m.state.fsm = makeMournFsm(m);
  },
  update(m, dt) {
    // A knot goes: the fight's progress display, and the moment it grows
    // more dangerous rather than less.
    const gone = shattered(m);
    if (gone > (m.state.shown as number)) {
      m.state.shown = gone;
      m.game.feel.slowmo(0.45, 0.3);
      m.game.feel.shake(0.7);
      m.game.feel.sfx.play('kill');
      m.game.feel.text(m.cx, m.y - 10, t('KNOT SHATTERED'), MOURN_KNOT, 2);
      m.game.feel.burst(m.cx, m.cy, 20, {
        color: [MOURN_KNOT, MOURN_BODY], speed: 140, life: 0.5, drag: 2.5,
      });
    }
    // Last knot: the chamber hums on a rhythm, and the hum genuinely
    // MASKS footsteps (see `humming`) — the free approach the phase is
    // supposed to buy. It is not a kindness: the same beat throws a toll
    // wave, so the cover you walk under is also what is hunting you. The
    // window shuts for a breath around each beat, which is when it can
    // hear you again.
    //
    // This runs BEFORE the FSM, because the FSM is what listens. Setting
    // the mask afterwards left `listen` reading the previous frame's
    // value, and one footstep per cycle leaked through on the boundary —
    // measured at exactly 1 refresh in 129 masked frames, which is the
    // kind of "almost" that turns into a bug report later.
    m.state.humMask = 0;
    if (gone >= MOURN_KNOTS - 1) {
      const hum = ((m.state.hum as number) ?? 0) + dt;
      m.state.hum = hum;
      // Deaf except for a short breath on either side of the beat.
      m.state.humMask = hum > 0.35 && hum < 1.35 ? 1 : 0;
      if (hum > 1.6) {
        m.state.hum = 0;
        tollWave(m, m.facing as 1 | -1);
      }
    }
    (m.state.fsm as FSM<Monster>).update(dt);
  },
  draw(g, m) {
    const fsm = m.state.fsm as FSM<Monster>;
    const gone = shattered(m);
    // A hunched bell-shape.
    g.fillStyle = m.flashT > 0 ? COLORS.white : MOURN_BODY;
    g.fillRect(m.x + 2, m.y + 6, m.w - 4, m.h - 6);
    g.fillRect(m.x + 6, m.y + 2, m.w - 12, 6);
    // The four spine-knots: the health bar, worn on the body.
    for (let i = 0; i < MOURN_KNOTS; i++) {
      const kx = m.x + 6 + i * ((m.w - 12) / MOURN_KNOTS);
      if (i < MOURN_KNOTS - gone) {
        g.fillStyle = m.flashT > 0 ? COLORS.white : MOURN_KNOT;
        g.fillRect(kx, m.y + 9, 4, 5);
      } else {
        g.fillStyle = COLORS.bgDark; // a shattered knot leaves a socket
        g.fillRect(kx, m.y + 10, 4, 3);
      }
    }
    // The ear faces what it is listening to and glows with how sure it
    // is. A DIM ear is a stale belief — the tell that you have gone quiet
    // enough to move, and the one thing the player must learn to read.
    const ex = m.facing < 0 ? m.x + 1 : m.x + m.w - 4;
    g.globalAlpha = 0.35 + 0.65 * attention(m).sure;
    // A guest's puppet DOES have an FSM — `init` ran there too — it is
    // simply never stepped, so asking it would report `listen` forever.
    // The wire value is therefore the authority whenever one has arrived.
    const fixated = m.state.remoteFixate !== undefined
      ? m.state.remoteFixate === true
      : fsm.is('fixate');
    g.fillStyle = fixated ? COLORS.white : MOURN_EAR;
    g.fillRect(ex, m.y + 8, 3, 7);
    g.globalAlpha = 1;
  },
});
