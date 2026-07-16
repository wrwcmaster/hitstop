import { Registry } from '@engine/index';
import { COLORS } from './palette';
import { weaponVisuals } from './weapon-visuals';

export interface WeaponHitboxDef {
  /** Gap from the player's front edge; negative values overlap the body. */
  forward: number;
  /** Vertical offset from the player's center. */
  y: number;
  w: number;
  h: number;
}

export interface WeaponTrailDef {
  startAngle: number;
  endAngle: number;
  radius: number;
  thickness: number;
}

export interface WeaponAttackDef {
  /** Animation in the weapon visual's sprite sheet. */
  animation: string;
  /** Play authored animation frames forwards or backwards. */
  frameDirection: 1 | -1;
  duration: number;
  /** Normalized start/end of the damaging window. */
  active: readonly [number, number];
  damageScale: number;
  strength: number;
  lunge: number;
  hitbox: WeaponHitboxDef;
  trail: WeaponTrailDef;
  /** Body-English multiplier and vertical lift during the swing. */
  bodyWeight: number;
  lift: number;
  /** Fraction of horizontal velocity retained after one second. */
  movementKeep: number;
  finisher?: boolean;
}

export interface WeaponTypeDef {
  comboWindow: number;
  attacks: readonly WeaponAttackDef[];
}

export interface WeaponDef {
  id: string;
  type: string;
  visual: string;
  baseDamage: number;
  colors: readonly string[];
}

export const weaponTypes = new Registry<WeaponTypeDef>('weaponType');
export const weapons = new Registry<WeaponDef>('weapon');

function finite(value: number, path: string): void {
  if (!Number.isFinite(value)) throw new Error(`${path}: expected a finite number`);
}

export function defineWeaponType(id: string, def: WeaponTypeDef): void {
  if (!Number.isFinite(def.comboWindow) || def.comboWindow < 0) {
    throw new Error(`weapon type "${id}".comboWindow: expected a non-negative finite number`);
  }
  if (!def.attacks.length) throw new Error(`weapon type "${id}".attacks: expected at least one attack`);
  def.attacks.forEach((attack, index) => {
    const path = `weapon type "${id}".attacks[${index}]`;
    if (!attack.animation) throw new Error(`${path}.animation: expected a non-empty string`);
    if (attack.frameDirection !== 1 && attack.frameDirection !== -1) {
      throw new Error(`${path}.frameDirection: expected 1 or -1`);
    }
    for (const [field, value] of Object.entries({
      duration: attack.duration,
      damageScale: attack.damageScale,
      strength: attack.strength,
      lunge: attack.lunge,
      bodyWeight: attack.bodyWeight,
      lift: attack.lift,
      movementKeep: attack.movementKeep,
    })) finite(value, `${path}.${field}`);
    if (attack.duration <= 0 || attack.damageScale <= 0 || attack.bodyWeight <= 0) {
      throw new Error(`${path}: duration, damageScale, and bodyWeight must be positive`);
    }
    if (attack.movementKeep <= 0 || attack.movementKeep > 1) {
      throw new Error(`${path}.movementKeep: expected a value in (0, 1]`);
    }
    const [start, end] = attack.active;
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || start >= end || end > 1) {
      throw new Error(`${path}.active: expected 0 <= start < end <= 1`);
    }
    for (const [field, value] of Object.entries(attack.hitbox)) finite(value, `${path}.hitbox.${field}`);
    if (attack.hitbox.w <= 0 || attack.hitbox.h <= 0) {
      throw new Error(`${path}.hitbox: width and height must be positive`);
    }
    for (const [field, value] of Object.entries(attack.trail)) finite(value, `${path}.trail.${field}`);
    if (attack.trail.radius <= 0 || attack.trail.thickness <= 0) {
      throw new Error(`${path}.trail: radius and thickness must be positive`);
    }
  });
  weaponTypes.register(id, def);
}

export function defineWeapon(id: string, def: Omit<WeaponDef, 'id'>): void {
  if (!weaponTypes.has(def.type)) throw new Error(`weapon "${id}".type: unknown weapon type "${def.type}"`);
  if (!weaponVisuals.has(def.visual)) throw new Error(`weapon "${id}".visual: unknown visual "${def.visual}"`);
  if (!Number.isFinite(def.baseDamage) || def.baseDamage <= 0) {
    throw new Error(`weapon "${id}".baseDamage: expected a positive finite number`);
  }
  if (!def.colors.length || def.colors.some((color) => typeof color !== 'string')) {
    throw new Error(`weapon "${id}".colors: expected a non-empty string array`);
  }
  const visualAnimations = weaponVisuals.get(def.visual).animations;
  if (visualAnimations) {
    for (const attack of weaponTypes.get(def.type).attacks) {
      if (!visualAnimations.includes(attack.animation)) {
        throw new Error(`weapon "${id}": visual "${def.visual}" has no "${attack.animation}" animation`);
      }
    }
  }
  weapons.register(id, { id, ...def });
}

export function weaponDefOf(itemId: string | null): WeaponDef {
  return weapons.get(itemId ?? 'unarmed');
}

export function weaponTypeOf(weapon: WeaponDef): WeaponTypeDef {
  return weaponTypes.get(weapon.type);
}

const attack = (
  overrides: Partial<WeaponAttackDef> & Pick<WeaponAttackDef, 'duration' | 'active' | 'damageScale' | 'strength' | 'lunge' | 'hitbox' | 'trail'>,
): WeaponAttackDef => ({
  animation: 'attack',
  frameDirection: 1,
  bodyWeight: 1,
  lift: 0,
  movementKeep: 0.002,
  ...overrides,
});

defineWeaponType('unarmed', {
  comboWindow: 0.2,
  attacks: [
    attack({
      duration: 0.16, active: [0.16, 0.52], damageScale: 1, strength: 0.3, lunge: 20,
      hitbox: { forward: -2, y: 0, w: 14, h: 12 },
      trail: { startAngle: -0.9, endAngle: 0.8, radius: 10, thickness: 2.5 },
      bodyWeight: 0.75,
    }),
    attack({
      duration: 0.18, active: [0.18, 0.56], damageScale: 1, strength: 0.4, lunge: 30,
      hitbox: { forward: -2, y: -1, w: 16, h: 14 },
      trail: { startAngle: 0.9, endAngle: -0.8, radius: 11, thickness: 3 },
      frameDirection: -1,
      bodyWeight: 0.9,
      finisher: true,
    }),
  ],
});

defineWeaponType('sword', {
  comboWindow: 0.24,
  attacks: [
    attack({
      duration: 0.16, active: [0.15, 0.56], damageScale: 1, strength: 0.42, lunge: 45,
      hitbox: { forward: -2, y: 0, w: 20, h: 16 },
      trail: { startAngle: -1.3, endAngle: 1.3, radius: 13, thickness: 3.5 },
    }),
    attack({
      duration: 0.17, active: [0.14, 0.56], damageScale: 1, strength: 0.46, lunge: 50,
      hitbox: { forward: -2, y: -1, w: 20, h: 17 },
      trail: { startAngle: 1.3, endAngle: -1.3, radius: 14, thickness: 3.5 },
      frameDirection: -1,
      lift: 3,
    }),
    attack({
      duration: 0.25, active: [0.22, 0.62], damageScale: 2, strength: 0.8, lunge: 110,
      hitbox: { forward: -2, y: -1, w: 26, h: 20 },
      trail: { startAngle: -1.35, endAngle: 1.35, radius: 17, thickness: 5 },
      bodyWeight: 1.35,
      lift: 3,
      movementKeep: 0.0005,
      finisher: true,
    }),
  ],
});

defineWeaponType('great-sword', {
  comboWindow: 0.34,
  attacks: [
    attack({
      duration: 0.34, active: [0.3, 0.62], damageScale: 1, strength: 0.75, lunge: 25,
      hitbox: { forward: -3, y: -1, w: 31, h: 23 },
      trail: { startAngle: 1.4, endAngle: -1.35, radius: 21, thickness: 6 },
      frameDirection: -1,
      bodyWeight: 1.45,
      lift: 1,
      movementKeep: 0.0002,
    }),
    attack({
      duration: 0.46, active: [0.38, 0.7], damageScale: 2, strength: 1.15, lunge: 80,
      hitbox: { forward: -3, y: -2, w: 36, h: 27 },
      trail: { startAngle: -1.4, endAngle: 1.35, radius: 24, thickness: 8 },
      bodyWeight: 1.75,
      lift: 2,
      movementKeep: 0.0004,
      finisher: true,
    }),
  ],
});

defineWeapon('unarmed', {
  type: 'unarmed',
  visual: 'unarmed',
  baseDamage: 1,
  colors: [COLORS.white],
});

defineWeapon('rusty-sword', {
  type: 'sword',
  visual: 'rusty-sword',
  baseDamage: 1,
  colors: [COLORS.white, COLORS.gold],
});

defineWeapon('great-sword', {
  type: 'great-sword',
  visual: 'great-sword',
  baseDamage: 2,
  colors: [COLORS.gold, COLORS.white, COLORS.red],
});

/** Importing this module registers weapon types and concrete weapons. */
export function registerWeapons(): void {}
