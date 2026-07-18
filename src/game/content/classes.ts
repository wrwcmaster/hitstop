import { Registry, type StatMods } from '@engine/index';
import { COLORS } from './palette';
import type { Action } from '../defs';

/**
 * Character classes. A class is a lens on the same knight: its own base
 * stat modifiers (stats source `class:<id>`), its own skill loadout
 * (which action slots exist and what starts known), and its own *small*
 * skill tree (a grid of tree-node ids) — three shallow trees instead of
 * one sprawling one.
 *
 * Class change is free and non-destructive: each class remembers its own
 * unlocked nodes (skill points are one shared pool), and switching
 * strips the old class's effects and replays the new one's — the same
 * idempotent replay that save-restore uses. See Player.setClass.
 */

export interface ClassDef {
  /** Display name (uppercase, translated at render time). */
  name: string;
  desc: string;
  /** UI accent color. */
  color: string;
  /** Base stat modifiers while the class is active. */
  mods?: StatMods;
  /** Skill slots: which action casts which skill, and what starts known.
   * A slot absent here simply does nothing for this class. */
  loadout: readonly { action: Action; skillId: string; startsKnown?: boolean }[];
  /** Column headers for the tree UI, one per branch. */
  branchNames: string[];
  /** The class's skill tree: grid[branch][tier] = tree node id. */
  grid: string[][];
}

export const classes = new Registry<ClassDef>('class');

export function defineClass(id: string, def: ClassDef): void {
  classes.register(id, def);
}

/** New knights start here (and old saves migrate here). */
export const DEFAULT_CLASS = 'knight';

/** Which class's grid contains this tree node (old-save migration). */
export function classOfNode(nodeId: string): string | null {
  for (const [id, def] of classes.entries()) {
    if (def.grid.some((branch) => branch.includes(nodeId))) return id;
  }
  return null;
}

defineClass('knight', {
  name: 'KNIGHT',
  desc: 'Steel and stubbornness. Hits harder, stands longer.',
  color: COLORS.gold,
  mods: { add: { maxHp: 1 } },
  // The classic kit: fire in one hand, frost in the other.
  loadout: [
    { action: 'skill', skillId: 'fireball', startsKnown: true },
    { action: 'skill3', skillId: 'ice-shard', startsKnown: true },
  ],
  branchNames: ['STEEL', 'VALOR'],
  grid: [
    ['w1', 'w2', 'w3', 'w4'],
    ['v1', 'v2', 'v3', 'k1'],
  ],
});

defineClass('mage', {
  name: 'MAGE',
  desc: 'The arcane path. Deep mana, learned nova, thin armor.',
  color: '#b46ee6',
  mods: { add: { maxMp: 2 } },
  loadout: [
    { action: 'skill', skillId: 'fireball', startsKnown: true },
    { action: 'skill2', skillId: 'nova' }, // learned at NOVA (m3)
    { action: 'skill3', skillId: 'ice-shard', startsKnown: true },
  ],
  branchNames: ['ARCANA', 'FROST'],
  grid: [
    ['m1', 'm2', 'm3', 'm4', 'm5'],
    ['g1', 'g2', 'g3'],
  ],
});

defineClass('tidecaller', {
  name: 'TIDECALLER',
  desc: 'The drowned path. Fast on land, faster below.',
  color: '#73becb',
  mods: { mult: { speed: 1.08 } },
  loadout: [
    { action: 'skill3', skillId: 'ice-shard', startsKnown: true },
  ],
  branchNames: ['TIDE', 'WIND'],
  grid: [
    ['t1', 'v5', 'w5'],
    ['s1', 'v4', 's2'],
  ],
});

/** Importing this module registers the classes. */
export function registerClasses(): void {}
