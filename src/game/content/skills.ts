import { defineSkill } from '@engine/index';
import { COLORS } from './palette';
import type { ActionGame } from '../defs';
import type { Player } from '../actors/player';
import type { Action } from '../defs';
import { Monster } from '../actors/monster';

/** Context handed to skill casts. */
export interface SkillCtx {
  game: ActionGame;
  player: Player;
}

/** Input-to-skill mapping. Player dispatches this table without knowing skill ids. */
export const DEFAULT_SKILL_LOADOUT: readonly { action: Action; skillId: string; startsKnown?: boolean }[] = [
  { action: 'skill', skillId: 'fireball', startsKnown: true },
  { action: 'skill2', skillId: 'nova' },
  { action: 'skill3', skillId: 'ice-shard', startsKnown: true },
];

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
        onHit(target, p) {
          // Fire IGNITES: a burning DoT on the victim + a pop at impact.
          if (target instanceof Monster) target.statuses.apply('burning');
          game.feel.effect(p.x, p.y, 'explosion', 0.5);
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
          // PYRE (skill tree): the bolt goes out with a bang.
          if (player.capabilities.has('pyre')) {
            const blast = game.combat.strike({
              damage: 2,
              targets: 'enemy',
              attacker: player,
              strength: 0.8,
              colors: [COLORS.gold, COLORS.red, COLORS.white],
            });
            blast.apply({ x: p.x - 26, y: p.y - 22, w: 52, h: 44 });
            game.feel.effect(p.x, p.y, 'explosion', 1.4);
            return;
          }
          // Fizzle-out is still a little detonation.
          game.feel.effect(p.x, p.y, 'explosion', 0.7);
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
 * ICE SHARD — the other element: slower, weaker bolt that FREEZES what it
 * hits (the 'frozen' status halts the monster's brain — see statuses.ts).
 * Fire burns, ice freezes: one status + one effect definition each.
 */
defineSkill<SkillCtx>('ice-shard', {
  name: 'ICE SHARD',
  desc: 'A shard of ice. Freezes its victim solid.',
  cooldown: 1.8,
  cost: 1,
  cast({ game, player }) {
    const dir = player.facing;
    game.combat.shoot(
      {
        x: player.cx + dir * 8,
        y: player.cy - 1,
        vx: dir * 200,
        vy: 0,
        w: 6,
        h: 6,
        life: 1.2,
        strike: {
          damage: 1,
          targets: 'enemy',
          attacker: player,
          strength: 0.5,
          colors: ['#73eff7', COLORS.blue, COLORS.white],
        },
        onHit(target, p) {
          if (target instanceof Monster) target.statuses.apply('frozen');
          game.feel.effect(p.x, p.y, 'freeze');
        },
        draw(g, p) {
          // A glinting diamond shard.
          const flick = Math.floor(p.t * 30) % 2;
          g.save();
          g.translate(Math.round(p.x), Math.round(p.y));
          g.rotate(Math.PI / 4);
          g.fillStyle = flick ? '#73eff7' : COLORS.blue;
          g.fillRect(-3, -3, 6, 6);
          g.fillStyle = COLORS.white;
          g.fillRect(-1, -1, 2, 2);
          g.restore();
        },
        onExpire(p) {
          game.feel.effect(p.x, p.y, 'freeze', 0.6);
        },
      },
      player.collision,
    );
    player.vx -= dir * 30;
    game.feel.sfx.play('blip');
    game.feel.kick(-dir * 1, 0);
    game.feel.burst(player.cx + dir * 8, player.cy - 1, 5, {
      color: ['#73eff7', COLORS.white], speed: 50, life: 0.2,
      angle: dir > 0 ? 0 : Math.PI, spread: 1.2, drag: 4,
    });
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
