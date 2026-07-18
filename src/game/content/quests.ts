import { Registry } from '@engine/index';

/**
 * Quests: an NPC asks for help, the world tracks it, the NPC pays out.
 * Defs are data; the QuestLog on the player is the runtime (persisted in
 * saves). Kill-counting is fed by PlayScene's kill listener, so any
 * monster type can be a target with zero new code.
 */
/** What a quest pays out on turn-in. */
export interface QuestReward {
  gold?: number;
  items?: string[];
}

export interface QuestDef {
  name: string;
  desc: string;
  /** Kill-N-of-a-monster goal (the only goal kind so far). */
  kill: { type: string; count: number };
  reward: QuestReward;
}

export const quests = new Registry<QuestDef>('quest');

export function defineQuest(id: string, def: QuestDef): void {
  quests.register(id, def);
}

defineQuest('cull-slimes', {
  name: 'CULL THE SLIMES',
  desc: 'Slay 5 slimes for the town elder.',
  kill: { type: 'slime', count: 5 },
  reward: { gold: 50, items: ['potion'] },
});

/** One kill's effect on an active quest, for feedback. */
export interface QuestProgress {
  id: string;
  def: QuestDef;
  n: number;
  need: number;
  justCompleted: boolean;
}

export class QuestLog {
  /** Accepted quests: id -> kills so far. */
  active = new Map<string, number>();
  /** Turned-in quests (can't be re-taken). */
  done = new Set<string>();

  started(id: string): boolean {
    return this.active.has(id) || this.done.has(id);
  }

  start(id: string): void {
    if (!this.started(id)) this.active.set(id, 0);
  }

  isComplete(id: string): boolean {
    const n = this.active.get(id);
    return n !== undefined && n >= quests.get(id).kill.count;
  }

  /** Feed a kill; returns progress updates for every quest it advanced. */
  onKill(type: string): QuestProgress[] {
    const out: QuestProgress[] = [];
    for (const [id, n] of this.active) {
      const def = quests.get(id);
      if (def.kill.type !== type || n >= def.kill.count) continue;
      this.active.set(id, n + 1);
      out.push({ id, def, n: n + 1, need: def.kill.count, justCompleted: n + 1 === def.kill.count });
    }
    return out;
  }

  /** Complete + hand out: returns the def once, null if not ready. */
  turnIn(id: string): QuestDef | null {
    if (!this.isComplete(id)) return null;
    this.active.delete(id);
    this.done.add(id);
    return quests.get(id);
  }

  snapshot(): { active: [string, number][]; done: string[] } {
    return { active: [...this.active], done: [...this.done] };
  }

  restore(data?: { active: [string, number][]; done: string[] }): void {
    this.active = new Map(data?.active ?? []);
    this.done = new Set(data?.done ?? []);
  }
}

/** Importing this module registers the quests. */
export function registerQuests(): void {}
