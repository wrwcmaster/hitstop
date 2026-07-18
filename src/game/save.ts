import { JsonStore, t, type ItemStack } from '@engine/index';
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
  /** Wall-clock ms of the save, for "newest" and slot labels. */
  savedAt?: number;
  /** Story flags ('bossDefeated', ...). */
  flags: string[];
  /** Fired once-trigger indices per room id. */
  firedTriggers: Record<string, number[]>;
  player: {
    inventory: ItemStack[];
    equipped: [string, string][];
    skills: string[];
    gold: number;
    progression: { xp: number; level: number; skillPoints: number };
    tree: string[];
    /** Accepted quests (id, kills so far) + turned-in quest ids. */
    quests?: { active: [string, number][]; done: string[] };
    /** Blacksmith weapon upgrade level. */
    forgeLevel?: number;
  };
}

/** The autosave (checkpoints). Slot 0 in the slots UI. */
export const saveStore = new JsonStore<SaveData>('hitstop.save', 3);

/** Manual save slots (multi-slot saves; the town made saving a habit). */
export const SAVE_SLOT_COUNT = 3;
const slotStores = Array.from(
  { length: SAVE_SLOT_COUNT },
  (_, i) => new JsonStore<SaveData>(`hitstop.save.slot${i + 1}`, 3),
);

/** Store for a slot: 0 = autosave, 1..SAVE_SLOT_COUNT = manual slots. */
export function slotStore(slot: number): JsonStore<SaveData> {
  return slot === 0 ? saveStore : slotStores[slot - 1];
}

/** One line per slot for the save/load UI. */
export function slotSummary(slot: number): string {
  const d = slotStore(slot).load();
  const name = slot === 0 ? t('AUTO') : t('SLOT {n}', { n: slot });
  if (!d) return `${name}: ${t('empty')}`;
  return `${name}: ${d.roomId.toUpperCase()} LV${d.player.progression.level} ${d.player.gold}g`;
}

/** The most recent save across autosave + slots (for CONTINUE). */
export function newestSave(): SaveData | null {
  let best: SaveData | null = null;
  for (let s = 0; s <= SAVE_SLOT_COUNT; s++) {
    const d = slotStore(s).load();
    if (d && (!best || (d.savedAt ?? 0) > (best.savedAt ?? 0))) best = d;
  }
  return best;
}

export function snapshotPlayer(p: Player): SaveData['player'] {
  return {
    inventory: p.inventory.slots.map((s) => ({ ...s })),
    equipped: p.equipment.slots(),
    skills: [...p.skills.known],
    gold: p.gold,
    progression: p.progression.snapshot(),
    tree: p.tree.ownedIds(),
    quests: p.quests.snapshot(),
    forgeLevel: p.forgeLevel,
  };
}

export function restorePlayer(p: Player, data: SaveData['player']): void {
  p.inventory.clear();
  for (const s of data.inventory) p.inventory.add(s.id, s.count);
  p.equipment.clear();
  for (const [, id] of data.equipped) p.equipment.equip(id);
  for (const id of data.skills) p.skills.learn(id);
  p.gold = data.gold;
  p.progression.restore(data.progression);
  // Re-applies stat mods and onUnlock effects (learned skills) without cost.
  p.tree.restore(data.tree, { game: p.game, player: p });
  p.quests.restore(data.quests);
  p.forgeLevel = data.forgeLevel ?? 0;
  p.applyForge();
  p.syncStats();
  p.hp = p.maxHp;
  p.mp = p.maxMp;
}
