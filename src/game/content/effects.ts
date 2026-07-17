import { defineEffect } from '@engine/index';
import { COLORS } from './palette';

/**
 * Named particle effects: staged multi-emitter compositions played with
 * `feel.effect(x, y, '<id>', scale?)`. Each is a whole audiovisual beat
 * (particles + shake/flash/hitstop/sfx) authored once and reused — the
 * point of the system is that "an explosion" is one call everywhere.
 */

defineEffect('explosion', {
  shake: 0.6,
  flash: 0.18,
  flashColor: COLORS.gold,
  hitstop: 0.05,
  sfx: 'nova',
  emitters: [
    // Core flash: hot, fast, dies quickly.
    { count: 10, speed: 30, life: 0.16, size: 5, ramp: [COLORS.white, COLORS.gold], drag: 4 },
    // Fireball chunks: fire cooling into smoke.
    { count: 22, speed: 130, life: 0.5, size: 3, ramp: [COLORS.gold, COLORS.red, '#566c86'], grav: 60, drag: 2.5 },
    // Sparks: fast, thin, gravity-bitten.
    { count: 14, speed: 240, life: 0.45, size: 1.5, color: [COLORS.white, COLORS.gold], grav: 320, drag: 1.2 },
    // Shockwave ring.
    { count: 1, speed: 0, life: 0.3, size: 26, shape: 'ring', color: COLORS.gold },
    // Smoke: late, slow, rises.
    { count: 8, delay: 0.12, speed: 24, life: 0.7, size: 3, ramp: ['#566c86', '#333c57'], grav: -50, drag: 3 },
  ],
});

defineEffect('freeze', {
  flash: 0.1,
  flashColor: COLORS.blue,
  sfx: 'blip',
  emitters: [
    // Crystallizing shards, drifting out slowly and hanging.
    { count: 16, speed: 60, life: 0.5, size: 2, ramp: [COLORS.white, '#73eff7', COLORS.blue], drag: 4 },
    // A cold ring snapping shut around the target.
    { count: 1, speed: 0, life: 0.25, size: 18, shape: 'ring', color: '#73eff7' },
    // Lingering glints.
    { count: 6, delay: 0.1, speed: 12, life: 0.6, size: 1.5, color: [COLORS.white, '#73eff7'], grav: 20, drag: 2 },
  ],
});

/** Importing this module registers the effects. */
export function registerEffects(): void {}
