import { JsonStore, type ItemStack } from '@engine/index';
import type { Player } from './actors/player';

/**
 * Save games. A save is a checkpoint at a room entrance: which room,
 * what the player carries, which story flags and one-shot triggers have
 * fired, and the best score. HP/MP are deliberately NOT saved —
 * checkpoints restore you to full (deaths are punishing enough).
 */
export interface SaveData {
  roomId: string;
  best: number;
  /** Story flags ('bossDefeated', ...). */
  flags: string[];
  /** Fired once-trigger indices per room id. */
  firedTriggers: Record<string, number[]>;
  player: {
    inventory: ItemStack[];
    equipped: [string, string][];
    skills: string[];
    gold: number;
  };
}

export const saveStore = new JsonStore<SaveData>('hitstop.save', 2);

export function snapshotPlayer(p: Player): SaveData['player'] {
  return {
    inventory: p.inventory.slots.map((s) => ({ ...s })),
    equipped: p.equipment.slots(),
    skills: [...p.skills.known],
    gold: p.gold,
  };
}

export function restorePlayer(p: Player, data: SaveData['player']): void {
  p.inventory.clear();
  for (const s of data.inventory) p.inventory.add(s.id, s.count);
  p.equipment.clear();
  for (const [, id] of data.equipped) p.equipment.equip(id);
  for (const id of data.skills) p.skills.learn(id);
  p.gold = data.gold;
  p.syncStats();
  p.hp = p.maxHp;
  p.mp = p.maxMp;
}
