import { FSM, rand, pick } from '@engine/index';
import { defineMonster, Monster } from './monster';
import { SLIME1, SLIME2, TEXEL } from '../content/sprites';
import { tintOf, whiteOf } from '@engine/index';
import { COLORS } from '../content/palette';
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
