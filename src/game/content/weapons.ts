import { Registry } from '@engine/index';
import { COLORS } from './palette';
import { weaponVisuals, slashVisuals } from './weapon-visuals';

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
  /**
   * Where along the swept arc the blade is fattest, 0 (tail) to 1
   * (leading edge). This is what separates a crescent from a smear:
   * 0.5 is symmetric and reads as a moon — two sharp points with a
   * heavy belly, right for a committed swing you see complete. Higher
   * values pile the mass behind the tip so the arc reads as a comet
   * chasing the blade, right for fast attacks seen mid-sweep.
   */
  bias?: number;
  /**
   * Width of the soft halo outside the arc, as a multiple of
   * `thickness`. Nonzero makes the swing glow rather than merely
   * appear — reserve it for the heavy moves, so brightness stays a
   * signal that this one hits harder.
   */
  glow?: number;
  /**
   * Fraction of the attack the arc takes to draw itself, defaulting to
   * the end of the damage window. Separate from `active` on purpose:
   * how fast the blade LOOKS like it swept is not how long it can hit.
   * A plunge needs this — it stays dangerous for its whole descent but
   * is cut short by landing, so the crescent has to be fully formed in
   * the first few frames or a short drop never shows one.
   */
  sweep?: number;
  /**
   * Id of an authored slash sheet (see `defineSlashVisual`) to play
   * instead of drawing the arc procedurally. Registered by shape, not by
   * weapon, so one crescent serves every sword. Omit it and the attack
   * falls back to the procedural arc — which is why a new weapon still
   * looks right before anyone has drawn a single frame for it.
   */
  sprite?: string;
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
  /** Where the hitbox points: ahead of the knight (default), below her
   * feet (plunges), or above her head (anti-air). */
  aim?: 'forward' | 'down' | 'up';
  /** Landing a hit with this attack while airborne bounces the knight
   * up at this speed (the pogo — refreshes air jumps and the dash). */
  pogo?: number;
}

/**
 * A ranged weapon type: pressing attack looses a ballistic projectile
 * instead of swinging steel. Both projectile kinds ride the engine's
 * gravity-aware Projectile — arrows arc, bullets fly nearly flat.
 */
export interface RangedDef {
  projectile: 'arrow' | 'bullet';
  /** Muzzle speed at FULL power, px/s. */
  speed: number;
  /** Arc gravity in px/s² (arrows ~420; guns nearly 0). */
  gravity: number;
  /** Seconds between shots. */
  cooldown: number;
  /** Backward kick on the shooter, px/s. */
  recoil: number;
  /** Small vertical trim from the shared ranged hand line (see
   * RANGED_HAND_Y in weapon-visuals.ts) — shots spawn ON the drawn
   * weapon, this only nudges within it (a barrel above the grip, say). */
  muzzleY?: number;
  /**
   * Hold-to-charge (the engine's Charge gesture): holding attack draws
   * the weapon, releasing looses it. Power scales muzzle speed — which,
   * under gravity, IS the range — plus damage and recoil. `time` seconds
   * reaches full draw; a tap fires at `floor` power; `curve` shapes the
   * ramp (see engine/input/charge.ts). Weapons without this fire on
   * press, as ever.
   */
  charge?: { time: number; floor: number; curve?: number };
}

/**
 * A weapon type's full moveset: the grounded combo chain plus the
 * contextual attacks the player resolves from her situation — airborne
 * (aerial), airborne holding down (plunge), holding up (upper), or
 * mid-dash (dashAttack). Contextual entries are optional; a type
 * without one falls back to the first grounded swing. A type with
 * `ranged` shoots instead — its melee lists may be empty.
 */
export interface WeaponTypeDef {
  comboWindow: number;
  attacks: readonly WeaponAttackDef[];
  aerial?: WeaponAttackDef;
  plunge?: WeaponAttackDef;
  upper?: WeaponAttackDef;
  dashAttack?: WeaponAttackDef;
  ranged?: RangedDef;
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

/** Every attack a type owns, contextual entries included. */
export function allAttacks(type: WeaponTypeDef): WeaponAttackDef[] {
  return [
    ...type.attacks,
    ...[type.aerial, type.plunge, type.upper, type.dashAttack].filter((a): a is WeaponAttackDef => !!a),
  ];
}

export function defineWeaponType(id: string, def: WeaponTypeDef): void {
  if (!Number.isFinite(def.comboWindow) || def.comboWindow < 0) {
    throw new Error(`weapon type "${id}".comboWindow: expected a non-negative finite number`);
  }
  if (def.ranged) {
    const r = def.ranged;
    if (r.projectile !== 'arrow' && r.projectile !== 'bullet') {
      throw new Error(`weapon type "${id}".ranged.projectile: expected 'arrow' or 'bullet'`);
    }
    for (const [field, value] of Object.entries({
      speed: r.speed, gravity: r.gravity, cooldown: r.cooldown, recoil: r.recoil,
    })) finite(value, `weapon type "${id}".ranged.${field}`);
    if (r.speed <= 0 || r.cooldown <= 0 || r.gravity < 0 || r.recoil < 0) {
      throw new Error(`weapon type "${id}".ranged: speed/cooldown must be positive, gravity/recoil non-negative`);
    }
    if (r.charge) {
      finite(r.charge.time, `weapon type "${id}".ranged.charge.time`);
      finite(r.charge.floor, `weapon type "${id}".ranged.charge.floor`);
      if (r.charge.time <= 0 || r.charge.floor <= 0 || r.charge.floor > 1) {
        throw new Error(`weapon type "${id}".ranged.charge: time must be positive, floor in (0..1]`);
      }
    }
  }
  if (!def.attacks.length && !def.ranged) {
    throw new Error(`weapon type "${id}".attacks: expected at least one attack`);
  }
  const named: [string, WeaponAttackDef][] = def.attacks.map((a, i) => [`attacks[${i}]`, a]);
  for (const key of ['aerial', 'plunge', 'upper', 'dashAttack'] as const) {
    if (def[key]) named.push([key, def[key]]);
  }
  named.forEach(([slot, attack]) => {
    const path = `weapon type "${id}".${slot}`;
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
    for (const [field, value] of Object.entries(attack.trail)) {
      if (field === 'sprite') continue; // the one non-numeric trail field
      finite(value, `${path}.trail.${field}`);
    }
    if (attack.trail.sprite !== undefined && !slashVisuals.has(attack.trail.sprite)) {
      throw new Error(`${path}.trail.sprite: unknown slash visual "${attack.trail.sprite}"`);
    }
    if (attack.trail.radius <= 0 || attack.trail.thickness <= 0) {
      throw new Error(`${path}.trail: radius and thickness must be positive`);
    }
    if (attack.trail.bias !== undefined && (attack.trail.bias <= 0 || attack.trail.bias >= 1)) {
      throw new Error(`${path}.trail.bias: expected a value in (0, 1)`);
    }
    if (attack.trail.glow !== undefined && attack.trail.glow < 0) {
      throw new Error(`${path}.trail.glow: expected a non-negative number`);
    }
    if (attack.trail.sweep !== undefined && (attack.trail.sweep <= 0 || attack.trail.sweep > 1)) {
      throw new Error(`${path}.trail.sweep: expected a value in (0, 1]`);
    }
    if (attack.pogo !== undefined && (!Number.isFinite(attack.pogo) || attack.pogo <= 0)) {
      throw new Error(`${path}.pogo: expected a positive finite number`);
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
    for (const attack of allAttacks(weaponTypes.get(def.type))) {
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

/**
 * The contextual moveset, scaled per weapon class. `reach` is the
 * forward hitbox width, `arc` the vertical coverage, `heft` scales
 * damage/feel for heavier steel.
 */
const contextuals = (p: { reach: number; arc: number; heft: number }) => ({
  // Jump attack: a quick mid-air swipe that keeps your momentum.
  // Every contextual names its OWN animation. Sheets satisfy a slot
  // with real frames or a one-line alias ("plunge": "attack"), so each
  // move can grow distinct art without any sheet paying up front.
  aerial: attack({
    animation: 'aerial',
    duration: 0.15, active: [0.1, 0.55], damageScale: 1, strength: 0.4 * p.heft, lunge: 0,
    hitbox: { forward: -2, y: 0, w: p.reach, h: p.arc },
    trail: { startAngle: -1.2, endAngle: 1.2, radius: p.reach * 0.65, thickness: 3 },
    movementKeep: 0.9,
    bodyWeight: 0.8,
  }),
  // Down attack: point the steel at the ground and ride gravity. A hit
  // pogos the knight back into the air with her dash and jumps refreshed.
  plunge: attack({
    animation: 'plunge',
    duration: 0.9, active: [0.06, 1], damageScale: 1.3 * p.heft, strength: 0.7 * p.heft, lunge: 0,
    aim: 'down', pogo: 250,
    hitbox: { forward: -3, y: 0, w: p.arc + 6, h: 13 },
    // A moon under her feet: symmetric belly, points at both tips, and
    // wide enough to span the pogo hitbox. It forms fast (the sweep
    // eases out) then rides the whole fall, so the shape is legible for
    // as long as the attack can actually pogo something.
    trail: {
      startAngle: 0.45, endAngle: 2.69, radius: p.reach * 0.8, thickness: 5,
      bias: 0.5, glow: 1.8, sweep: 0.16, sprite: 'crescent',
    },
    movementKeep: 0.35,
    bodyWeight: 1.1,
  }),
  // Up attack: the anti-air arc for bats and anything overhead.
  upper: attack({
    animation: 'upper',
    duration: 0.16, active: [0.1, 0.55], damageScale: 1, strength: 0.45 * p.heft, lunge: 0,
    aim: 'up',
    hitbox: { forward: -3, y: 0, w: p.reach, h: 13 },
    trail: { startAngle: -0.8, endAngle: -2.3, radius: p.reach * 0.65, thickness: 3.5 },
    movementKeep: 0.5,
  }),
  // Dash attack: steel follows speed — a committed thrust out of the dash.
  dashAttack: attack({
    animation: 'dash',
    duration: 0.2, active: [0.05, 0.6], damageScale: 1.5 * p.heft, strength: 0.8, lunge: 120,
    hitbox: { forward: 0, y: 0, w: p.reach + 8, h: p.arc - 2 },
    // The showpiece: a near-half-circle from overhead down past her
    // feet, thrown in 0.12s. Biased toward the tip so the mass trails
    // the blade like a comet, and the widest glow in the moveset — this
    // is the hardest-hitting contextual, and it should look like it.
    trail: {
      startAngle: -1.5, endAngle: 1.5, radius: p.reach * 1.15, thickness: 5,
      bias: 0.72, glow: 2.2,
    },
    movementKeep: 0.6,
    bodyWeight: 1.2,
  }),
});

defineWeaponType('unarmed', {
  comboWindow: 0.2,
  ...contextuals({ reach: 14, arc: 12, heft: 0.8 }),
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
  ...contextuals({ reach: 20, arc: 16, heft: 1 }),
  attacks: [
    attack({
      duration: 0.16, active: [0.15, 0.56], damageScale: 1, strength: 0.42, lunge: 45,
      hitbox: { forward: -2, y: 0, w: 20, h: 16 },
      trail: { startAngle: -1.3, endAngle: 1.3, radius: 13, thickness: 3.5 },
    }),
    attack({
      animation: 'attack2',
      duration: 0.17, active: [0.14, 0.56], damageScale: 1, strength: 0.46, lunge: 50,
      hitbox: { forward: -2, y: -1, w: 20, h: 17 },
      trail: { startAngle: 1.3, endAngle: -1.3, radius: 14, thickness: 3.5 },
      frameDirection: -1,
      lift: 3,
    }),
    attack({
      animation: 'attack3',
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
  ...contextuals({ reach: 28, arc: 20, heft: 1.3 }),
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
      animation: 'attack2',
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

/* ---- ranged types: the attack button shoots ---- */

// The bow: arrows leave at a real muzzle speed and arc under gravity —
// aim up for distance, or loose flat and let the drop do the work.
// DRAWN, not clicked: hold attack and the string pulls back — how long
// you hold decides how fast (and so how far) the arrow flies. A tap is
// a weak close lob; ~0.8s is a full-power shot at the old fixed speed.
// The curve back-loads the ramp so the last beat of the draw matters.
defineWeaponType('bow', {
  comboWindow: 0,
  attacks: [],
  ranged: {
    projectile: 'arrow', speed: 330, gravity: 420, cooldown: 0.55, recoil: 30,
    charge: { time: 0.8, floor: 0.4, curve: 1.4 },
  },
});

// The flintlock: a fast, nearly-flat shot with a real kick. Slow to
// reload — every bang has to count.
defineWeaponType('gun', {
  comboWindow: 0,
  attacks: [],
  ranged: { projectile: 'bullet', speed: 640, gravity: 30, cooldown: 0.85, recoil: 90, muzzleY: -0.25 },
});

defineWeapon('unarmed', {
  type: 'unarmed',
  visual: 'unarmed',
  baseDamage: 20,
  colors: [COLORS.white],
});

defineWeapon('rusty-sword', {
  type: 'sword',
  visual: 'rusty-sword',
  baseDamage: 20,
  colors: [COLORS.white, COLORS.gold],
});

defineWeapon('great-sword', {
  type: 'great-sword',
  visual: 'great-sword',
  baseDamage: 40,
  colors: [COLORS.gold, COLORS.white, COLORS.red],
});

defineWeapon('hunting-bow', {
  type: 'bow',
  visual: 'hunting-bow',
  baseDamage: 40,
  colors: ['#8a6b3f', COLORS.steel],
});

defineWeapon('flintlock', {
  type: 'gun',
  visual: 'flintlock',
  baseDamage: 60,
  colors: [COLORS.gold, COLORS.steel],
});

/** Importing this module registers weapon types and concrete weapons. */
export function registerWeapons(): void {}
