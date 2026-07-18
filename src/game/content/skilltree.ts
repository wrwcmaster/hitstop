import { defineTreeNode } from '@engine/index';
import type { ActionGame } from '../defs';
import type { Player } from '../actors/player';

/** Context handed to tree node unlock hooks. */
export interface TreeCtx {
  game: ActionGame;
  player: Player;
}

/**
 * The skill tree nodes. Effects are either declarative stat mods
 * (applied while owned, restored with saves) or onUnlock hooks.
 * Mechanics grant named player capabilities/modifiers, so runtime code
 * never depends on tree node ids; active skills are learned through the
 * same hook.
 *
 * Nodes are grouped into per-class trees — the grids live in
 * content/classes.ts, and `requires` chains stay within one class's
 * grid. The `branch`/`tier` fields mirror the grid position.
 */

/* ================ KNIGHT ================ */

/* ---- STEEL ---- */

defineTreeNode<TreeCtx>('w1', {
  name: 'SHARP STEEL',
  desc: '+1 attack on every swing',
  cost: 1, branch: 0, tier: 0,
  mods: { add: { attack: 1 } },
});

defineTreeNode<TreeCtx>('w2', {
  name: 'HEAVY HANDS',
  desc: '+1 more attack',
  cost: 1, branch: 0, tier: 1, requires: ['w1'],
  mods: { add: { attack: 1 } },
});

defineTreeNode<TreeCtx>('w3', {
  name: 'EXECUTIONER',
  desc: 'Heavy finisher deals +2 damage',
  cost: 2, branch: 0, tier: 2, requires: ['w2'],
  onUnlock({ player }) {
    player.capabilities.enable('heavyFinisherBonus');
  },
});

defineTreeNode<TreeCtx>('w4', {
  name: 'DASH STRIKE',
  desc: 'Dashing through enemies cuts them',
  cost: 3, branch: 0, tier: 3, requires: ['w3'],
  onUnlock({ player }) {
    player.capabilities.enable('dashStrike');
  },
});

/* ---- VALOR ---- */

defineTreeNode<TreeCtx>('v1', {
  name: 'TOUGH SKIN',
  desc: '+1 max HP',
  cost: 1, branch: 1, tier: 0,
  mods: { add: { maxHp: 1 } },
});

defineTreeNode<TreeCtx>('v2', {
  name: 'STOUT HEART',
  desc: '+2 max HP',
  cost: 1, branch: 1, tier: 1, requires: ['v1'],
  mods: { add: { maxHp: 2 } },
});

defineTreeNode<TreeCtx>('v3', {
  name: 'SECOND WIND',
  desc: 'Heal 1 HP on every wave clear',
  cost: 2, branch: 1, tier: 2, requires: ['v2'],
  onUnlock({ player }) {
    player.capabilities.enable('secondWind');
  },
});

defineTreeNode<TreeCtx>('k1', {
  name: 'COLOSSUS',
  desc: '+2 max HP and +1 attack',
  cost: 3, branch: 1, tier: 3, requires: ['v3'],
  mods: { add: { maxHp: 2, attack: 1 } },
});

/* ================ MAGE ================ */

/* ---- ARCANA ---- */

defineTreeNode<TreeCtx>('m1', {
  name: 'DEEP WELL',
  desc: '+1 max MP',
  cost: 1, branch: 2, tier: 0,
  mods: { add: { maxMp: 1 } },
});

defineTreeNode<TreeCtx>('m2', {
  name: 'ARCANE FLOW',
  desc: 'Skill cooldowns halved',
  cost: 1, branch: 2, tier: 1, requires: ['m1'],
  onUnlock({ player }) {
    player.capabilities.setModifier('skillCooldownScale', 0.5);
  },
});

defineTreeNode<TreeCtx>('m3', {
  name: 'NOVA',
  desc: 'Learn NOVA: ring blast on V. 2 MP.',
  cost: 2, branch: 2, tier: 2, requires: ['m2'],
  onUnlock({ player }) {
    player.skills.learn('nova');
  },
});

defineTreeNode<TreeCtx>('m4', {
  name: 'PYRE',
  desc: 'Fireballs explode where they die',
  cost: 3, branch: 2, tier: 3, requires: ['m3'],
  onUnlock({ player }) {
    player.capabilities.enable('pyre');
  },
});

defineTreeNode<TreeCtx>('m5', {
  name: 'ABYSSAL WELL',
  desc: '+1 max MP from the deep',
  cost: 3, branch: 0, tier: 4, requires: ['m4'],
  mods: { add: { maxMp: 1 } },
});

/* ---- FROST ---- */

defineTreeNode<TreeCtx>('g1', {
  name: 'RIME WELL',
  desc: '+1 max MP',
  cost: 1, branch: 1, tier: 0,
  mods: { add: { maxMp: 1 } },
});

defineTreeNode<TreeCtx>('g2', {
  name: 'GLACIAL SKIN',
  desc: '+1 max HP',
  cost: 1, branch: 1, tier: 1, requires: ['g1'],
  mods: { add: { maxHp: 1 } },
});

defineTreeNode<TreeCtx>('g3', {
  name: "WINTER'S EDGE",
  desc: '+1 attack, frost-sharpened',
  cost: 2, branch: 1, tier: 2, requires: ['g2'],
  mods: { add: { attack: 1 } },
});

/* ================ TIDECALLER ================ */

/* ---- TIDE ---- */

defineTreeNode<TreeCtx>('t1', {
  name: 'OTTER BLOOD',
  desc: '+1 max HP, stronger strokes',
  cost: 1, branch: 0, tier: 0,
  mods: { add: { maxHp: 1 } },
  onUnlock({ player }) {
    player.capabilities.setModifier('swimBoost', 0.25);
  },
});

defineTreeNode<TreeCtx>('v5', {
  name: 'DEEP LUNGS',
  desc: 'Much longer breath, stronger strokes',
  cost: 2, branch: 0, tier: 1, requires: ['t1'],
  onUnlock({ player }) {
    player.capabilities.setModifier('extraAirSeconds', 6);
    player.capabilities.setModifier('swimBoost', 0.5);
  },
});

defineTreeNode<TreeCtx>('w5', {
  name: 'TIDE BREAKER',
  desc: '+2 attack on every swing',
  cost: 3, branch: 0, tier: 2, requires: ['v5'],
  mods: { add: { attack: 2 } },
});

/* ---- WIND ---- */

defineTreeNode<TreeCtx>('s1', {
  name: 'FLEET FOOT',
  desc: 'Run 15% faster',
  cost: 1, branch: 1, tier: 0,
  mods: { mult: { speed: 1.15 } },
});

defineTreeNode<TreeCtx>('v4', {
  name: 'SKY DANCER',
  desc: 'Double jump: press jump again in the air',
  cost: 3, branch: 1, tier: 1, requires: ['s1'],
  onUnlock({ player }) {
    player.capabilities.setModifier('airJumps', 1);
  },
});

defineTreeNode<TreeCtx>('s2', {
  name: 'GALE DASH',
  desc: 'Dash cooldown nearly halved',
  cost: 2, branch: 1, tier: 2, requires: ['v4'],
  onUnlock({ player }) {
    player.capabilities.setModifier('dashCooldownScale', 0.55);
  },
});

/** Importing this module registers the tree. */
export function registerSkillTree(): void {}
