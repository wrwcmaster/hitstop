import { defineSkill } from '@engine/index';
import { COLORS } from './palette';
import type { ActionGame } from '../defs';
import type { Player } from '../actors/player';

/** Context handed to skill casts. */
export interface SkillCtx {
  game: ActionGame;
  player: Player;
}

/**
 * Skills, including magic. A cast typically fires a Projectile or a
 * Strike, so the feedback bundle comes free; add the signature flourish
 * (muzzle burst, recoil, sound) here.
 */
defineSkill<SkillCtx>('fireball', {
  name: 'FIREBALL',
  desc: 'Hurl fire. Pierces two foes.',
  cooldown: 1.1,
  cost: 1,
  cast({ game, player }) {
    const dir = player.facing;
    game.combat.shoot(
      {
        x: player.cx + dir * 8,
        y: player.cy - 1,
        vx: dir * 250,
        vy: 0,
        w: 6,
        h: 6,
        life: 1.4,
        pierce: 2,
        strike: {
          damage: 2,
          targets: 'enemy',
          attacker: player,
          strength: 0.7,
          colors: [COLORS.gold, COLORS.red, COLORS.white],
        },
        draw(g, p) {
          // Flickering two-tone flame with a sparse trail.
          const flick = Math.floor(p.t * 30) % 2;
          g.fillStyle = flick ? COLORS.gold : COLORS.red;
          g.fillRect(Math.round(p.x - 3), Math.round(p.y - 3), 6, 6);
          g.fillStyle = COLORS.white;
          g.fillRect(Math.round(p.x - 1), Math.round(p.y - 1), 3, 3);
        },
        onExpire(p) {
          game.feel.burst(p.x, p.y, 8, {
            color: [COLORS.gold, COLORS.red], speed: 90, life: 0.3, drag: 3,
          });
        },
      },
      player.collision,
    );
    // Cast feedback: recoil, muzzle flash, sound.
    player.vx -= dir * 40;
    game.feel.sfx.play('fireball');
    game.feel.kick(-dir * 1.5, 0);
    game.feel.burst(player.cx + dir * 8, player.cy - 1, 6, {
      color: [COLORS.gold, COLORS.white], speed: 60, life: 0.2,
      angle: dir > 0 ? 0 : Math.PI, spread: 1.2, drag: 4,
    });
    // Trail system: a few embers per cast frame come from the projectile's
    // draw; heavier trails would go in a world system.
  },
});

/**
 * NOVA — the skill tree's capstone: a ring of force around the knight.
 * Unlocked via the MAGIC branch, cast with V.
 */
defineSkill<SkillCtx>('nova', {
  name: 'NOVA',
  desc: 'A ring of force blasts everything nearby.',
  cooldown: 4,
  cost: 2,
  cast({ game, player }) {
    const strike = game.combat.strike({
      damage: 3,
      targets: 'enemy',
      attacker: player,
      strength: 0.9,
      knockback: 320,
      popY: -160,
      colors: [COLORS.blue, COLORS.white, COLORS.gold],
    });
    strike.apply({ x: player.cx - 45, y: player.cy - 35, w: 90, h: 70 });

    // The blast itself: two expanding rings of particles + a flash.
    game.feel.hitstop(0.06);
    game.feel.shake(0.5);
    game.feel.flash(0.25, COLORS.blue);
    game.feel.sfx.play('nova');
    game.feel.burst(player.cx, player.cy, 26, {
      color: [COLORS.blue, COLORS.white], speed: 220, life: 0.35, drag: 3.5,
    });
    game.feel.burst(player.cx, player.cy, 14, {
      color: [COLORS.gold, COLORS.white], speed: 120, life: 0.45, drag: 3,
    });
  },
});

/** Importing this module registers the skill catalog. */
export function registerSkills(): void {}
