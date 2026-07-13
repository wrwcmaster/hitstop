import { defineTreeNode } from '@engine/index';
import type { ActionGame } from '../defs';
import type { Player } from '../actors/player';

/** Context handed to tree node unlock hooks. */
export interface TreeCtx {
  game: ActionGame;
  player: Player;
}

/**
 * The knight's skill tree: three branches, three tiers. Effects are
 * either declarative stat mods (applied while owned, restored with
 * saves) or onUnlock hooks (learning Nova); a couple of nodes are
 * checked by name where their mechanic lives (Executioner in
 * Player.beginAttack, Second Wind in the wave-clear handler, Arcane
 * Flow in the SkillBook's cooldown scale).
 */

export const BRANCH_NAMES = ['WARRIOR', 'VITALITY', 'MAGIC'];

/** Grid for the tree UI: TREE_GRID[branch][tier] = node id. */
export const TREE_GRID: string[][] = [
  ['w1', 'w2', 'w3', 'w4'],
  ['v1', 'v2', 'v3', 'v4'],
  ['m1', 'm2', 'm3', 'm4'],
];

/* ---- WARRIOR ---- */

defineTreeNode<TreeCtx>('w1', {
  name: 'SHARP STEEL',
  desc: '+1 ATTACK ON EVERY SWING',
  cost: 1, branch: 0, tier: 0,
  mods: { add: { attack: 1 } },
});

defineTreeNode<TreeCtx>('w2', {
  name: 'HEAVY HANDS',
  desc: '+1 MORE ATTACK',
  cost: 1, branch: 0, tier: 1, requires: ['w1'],
  mods: { add: { attack: 1 } },
});

defineTreeNode<TreeCtx>('w3', {
  name: 'EXECUTIONER',
  desc: 'HEAVY FINISHER DEALS +2 DAMAGE',
  cost: 2, branch: 0, tier: 2, requires: ['w2'],
  // Checked by name in Player.beginAttack.
});

defineTreeNode<TreeCtx>('w4', {
  name: 'DASH STRIKE',
  desc: 'DASHING THROUGH ENEMIES CUTS THEM',
  cost: 3, branch: 0, tier: 3, requires: ['w3'],
  // Checked by name in Player.beginDash.
});

/* ---- VITALITY ---- */

defineTreeNode<TreeCtx>('v1', {
  name: 'TOUGH SKIN',
  desc: '+1 MAX HP',
  cost: 1, branch: 1, tier: 0,
  mods: { add: { maxHp: 1 } },
});

defineTreeNode<TreeCtx>('v2', {
  name: 'STOUT HEART',
  desc: '+2 MAX HP',
  cost: 1, branch: 1, tier: 1, requires: ['v1'],
  mods: { add: { maxHp: 2 } },
});

defineTreeNode<TreeCtx>('v3', {
  name: 'SECOND WIND',
  desc: 'HEAL 1 HP ON EVERY WAVE CLEAR',
  cost: 2, branch: 1, tier: 2, requires: ['v2'],
  // Checked by name in the PlayScene's waveClear handler.
});

defineTreeNode<TreeCtx>('v4', {
  name: 'SKY DANCER',
  desc: 'DOUBLE JUMP: PRESS JUMP AGAIN IN THE AIR',
  cost: 3, branch: 1, tier: 3, requires: ['v3'],
  // Checked by name in the Player's landing logic (airJumps refresh).
});

/* ---- MAGIC ---- */

defineTreeNode<TreeCtx>('m1', {
  name: 'DEEP WELL',
  desc: '+1 MAX MP',
  cost: 1, branch: 2, tier: 0,
  mods: { add: { maxMp: 1 } },
});

defineTreeNode<TreeCtx>('m2', {
  name: 'ARCANE FLOW',
  desc: 'SKILL COOLDOWNS HALVED',
  cost: 1, branch: 2, tier: 1, requires: ['m1'],
  // Checked by name in the Player's SkillBook cooldownScale.
});

defineTreeNode<TreeCtx>('m3', {
  name: 'NOVA',
  desc: 'LEARN NOVA: RING BLAST ON V. 2 MP.',
  cost: 2, branch: 2, tier: 2, requires: ['m2'],
  onUnlock({ player }) {
    player.skills.learn('nova');
  },
});

defineTreeNode<TreeCtx>('m4', {
  name: 'PYRE',
  desc: 'FIREBALLS EXPLODE WHERE THEY DIE',
  cost: 3, branch: 2, tier: 3, requires: ['m3'],
  // Checked by name in the fireball's onExpire.
});

/** Importing this module registers the tree. */
export function registerSkillTree(): void {}
