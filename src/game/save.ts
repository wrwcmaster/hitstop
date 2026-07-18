import { SlotVault, t, type JsonStore, type ItemStack } from '@engine/index';
import type { Player } from './actors/player';
import { classOfNode, DEFAULT_CLASS } from './content/classes';

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
  /** Current wave in a wave-combat room, so a checkpoint resumes the
   * gauntlet instead of restarting at wave 1 (absent = no waves). */
  wave?: number;
  player: {
    inventory: ItemStack[];
    equipped: [string, string][];
    skills: string[];
    gold: number;
    progression: { xp: number; level: number; skillPoints: number };
    /** Legacy: the active class's unlocked nodes (kept for old readers). */
    tree: string[];
    /** Active class id (absent in old saves → knight). */
    classId?: string;
    /** Every class's unlocked nodes, active and dormant alike. */
    trees?: Record<string, string[]>;
    /** Accepted quests (id, kills so far) + turned-in quest ids. */
    quests?: { active: [string, number][]; done: string[] };
    /** Blacksmith weapon upgrade level. */
    forgeLevel?: number;
  };
}

/** Autosave + manual slots (the town made saving a habit). */
export const SAVE_SLOT_COUNT = 3;
const vault = new SlotVault<SaveData>('hitstop.save', 3, SAVE_SLOT_COUNT, (d) => d.savedAt ?? 0);

/** The autosave (checkpoints). Slot 0 in the slots UI. */
export const saveStore = vault.store(0);

/** Store for a slot: 0 = autosave, 1..SAVE_SLOT_COUNT = manual slots. */
export function slotStore(slot: number): JsonStore<SaveData> {
  return vault.store(slot);
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
  return vault.newest();
}

export function snapshotPlayer(p: Player): SaveData['player'] {
  return {
    inventory: p.inventory.slots.map((s) => ({ ...s })),
    equipped: p.equipment.slots(),
    skills: [...p.skills.known],
    gold: p.gold,
    progression: p.progression.snapshot(),
    tree: p.tree.ownedIds(),
    classId: p.classId,
    trees: p.snapshotTrees(),
    quests: p.quests.snapshot(),
    forgeLevel: p.forgeLevel,
  };
}

/** Pre-class saves held one flat node list; deal it out to the class
 * whose tree grid contains each node (unclaimed nodes are dropped). */
function migrateFlatTree(flat: string[]): Record<string, string[]> {
  const trees: Record<string, string[]> = {};
  for (const id of flat) {
    const cls = classOfNode(id);
    if (cls) (trees[cls] ??= []).push(id);
  }
  return trees;
}

export function restorePlayer(p: Player, data: SaveData['player']): void {
  p.inventory.clear();
  for (const s of data.inventory) p.inventory.add(s.id, s.count);
  p.equipment.clear();
  for (const [, id] of data.equipped) p.equipment.equip(id);
  p.gold = data.gold;
  p.progression.restore(data.progression);
  // Class + trees: re-applies class mods, stat mods, and onUnlock
  // effects (learned skills) without cost. Old flat saves migrate by
  // sorting each node into the class whose grid contains it.
  p.restoreClasses(data.classId ?? DEFAULT_CLASS, data.trees ?? migrateFlatTree(data.tree));
  // After the class settles its loadout: any extra known skills
  // (class change wipes and replays the book, so this must come last).
  for (const id of data.skills) p.skills.learn(id);
  p.quests.restore(data.quests);
  p.forgeLevel = data.forgeLevel ?? 0;
  p.applyForge();
  p.syncStats();
  p.hp = p.maxHp;
  p.mp = p.maxMp;
}
