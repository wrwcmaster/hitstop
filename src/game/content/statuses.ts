import { defineStatus } from '@engine/index';
import { COLORS } from './palette';
import type { Player } from '../actors/player';
import type { Monster } from '../actors/monster';

/**
 * Buffs and debuffs. Stat modifiers apply/remove automatically for the
 * status's lifetime; hooks add the flavor.
 */

/** Slime-ball residue: movement slowed. */
defineStatus('sticky', {
  name: 'STICKY',
  color: COLORS.green,
  duration: 2.5,
  mods: { mult: { speed: 0.45 } },
  onApply(a) {
    const p = a as Player;
    p.feel.text(p.cx, p.y - 10, 'SLOWED', COLORS.green);
  },
  onTick(a) {
    const p = a as Player;
    p.feel.particles.spawn({
      x: p.cx, y: p.y + p.h - 1, vy: 8, life: 0.4, size: 2, color: COLORS.green, drag: 1,
    });
  },
  tickEvery: 0.25,
});

/** Haste draught: move like the wind. */
defineStatus('haste', {
  name: 'HASTE',
  color: COLORS.gold,
  duration: 6,
  mods: { mult: { speed: 1.5 } },
  onApply(a) {
    const p = a as Player;
    p.feel.text(p.cx, p.y - 10, 'HASTE!', COLORS.gold);
  },
  onTick(a) {
    const p = a as Player;
    if (Math.abs(p.vx) > 40) {
      p.feel.particles.spawn({
        x: p.cx - Math.sign(p.vx) * 5, y: p.y + p.h - 3,
        vx: -Math.sign(p.vx) * 20, life: 0.3, size: 2, color: COLORS.gold, drag: 2,
      });
    }
  },
  tickEvery: 0.12,
});

/** Being digested: the Devourer's stomach. Damage is dealt by the
 * Devourer itself; this is the visible timer + HUD chip. */
defineStatus('devoured', {
  name: 'DEVOURED',
  color: COLORS.purple,
  duration: 99,
});

/* ---- elemental debuffs (carried by monsters; see Monster.statuses) ---- */

/** On fire: damage over time + flames licking upward. */
defineStatus('burning', {
  name: 'BURNING',
  color: COLORS.red,
  duration: 3,
  tickEvery: 0.5,
  onApply(a) {
    const m = a as Monster;
    m.game.feel.text(m.cx, m.y - 8, 'BURNING!', COLORS.red);
  },
  onTick(a) {
    const m = a as Monster;
    if (m.dead || m.hp <= 0) return;
    m.game.combat.hit(m, {
      damage: 1, targets: 'enemy', strength: 0.12, colors: [COLORS.red, COLORS.gold],
    });
    m.game.feel.burst(m.cx, m.y + m.h * 0.4, 4, {
      color: [COLORS.gold, COLORS.red, '#566c86'],
      speed: 26, life: 0.4, size: 2, grav: -90, drag: 2.5,
    });
  },
});

/** Frozen solid: the brain halts (Monster honors `halts`), encased in ice. */
defineStatus('frozen', {
  name: 'FROZEN',
  color: COLORS.blue,
  duration: 2,
  halts: true,
  veil: '#73eff7',
  onApply(a) {
    const m = a as Monster;
    m.game.feel.text(m.cx, m.y - 8, 'FROZEN!', '#73eff7');
  },
  onExpire(a) {
    const m = a as Monster;
    if (m.dead) return;
    // The ice shatters.
    m.game.feel.burst(m.cx, m.cy, 8, {
      color: ['#73eff7', COLORS.white], speed: 70, life: 0.35, drag: 3,
    });
  },
});

/** Importing this module registers the statuses. */
export function registerStatuses(): void {}
