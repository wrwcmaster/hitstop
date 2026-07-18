import { t, type LoadedSprite } from '@engine/index';
import { COLORS } from '../content/palette';
import type { QuestReward } from '../content/quests';
import type { NpcCtx, NpcDef } from './npc';
import type { Player } from './player';

/**
 * Reusable town-NPC behaviours. A role is a factory that returns an
 * NpcDef, so a healer, a smith, or a quest-giver is *data* — pick a
 * sprite and conversation, and the shared logic comes with it. Adding a
 * second quest-giver is one call, not a copy-pasted state machine.
 *
 * Crucially, the logic keys off each choice's semantic `action` id
 * ('heal', 'quest:accept', ...), never its display `label` — so writers
 * can reword dialogue without silently breaking a service.
 */

/** Fields common to the fixed-greeting roles (healer, smith). */
interface RoleBase {
  name: string;
  sprite: LoadedSprite;
  anim?: string;
  /** Conversation shown on interact. */
  greet: string;
}

/** A floating notice over the player (the town's standard feedback). */
function note(ctx: NpcCtx, text: string, color: string, scale = 1): void {
  ctx.game.feel.text(ctx.player.cx, ctx.player.y - 10, text, color, scale);
}

/** Charge `cost` gold; on failure show a notice + denied sound, return false. */
function spend(ctx: NpcCtx, cost: number): boolean {
  if (ctx.player.gold < cost) {
    note(ctx, t('NEED {n} GOLD', { n: cost }), COLORS.red);
    ctx.game.sfx.play('denied');
    return false;
  }
  ctx.player.gold -= cost;
  return true;
}

/** Pay a quest reward into the player (gold + items). */
export function grantReward(player: Player, reward: QuestReward): void {
  if (reward.gold) player.gold += reward.gold;
  for (const id of reward.items ?? []) player.inventory.add(id);
}

/** Restores HP/MP to full for a flat gold cost (choice action 'heal'). */
export function healer(cfg: RoleBase & { cost: number }): NpcDef {
  return {
    name: cfg.name,
    sprite: cfg.sprite,
    anim: cfg.anim,
    greet: cfg.greet,
    onChoice(choice, ctx) {
      if (choice.action !== 'heal') return;
      const { game, player } = ctx;
      if (player.hp >= player.maxHp && player.mp >= player.maxMp) {
        note(ctx, t('ALREADY WHOLE'), COLORS.steel);
        return;
      }
      if (!spend(ctx, cfg.cost)) return;
      player.hp = player.maxHp;
      player.mp = player.maxMp;
      game.feel.sfx.play('heal');
      game.feel.flash(0.15, COLORS.red);
      game.feel.burst(player.cx, player.cy, 14, {
        color: [COLORS.red, COLORS.white], speed: 50, life: 0.6, grav: -70, drag: 3,
      });
      note(ctx, t('HEALED'), COLORS.red);
    },
  };
}

/** Raises attack one forge level per tier in `costs` (choice action 'forge'). */
export function forge(cfg: RoleBase & { costs: number[] }): NpcDef {
  return {
    name: cfg.name,
    sprite: cfg.sprite,
    anim: cfg.anim,
    greet: cfg.greet,
    onChoice(choice, ctx) {
      if (choice.action !== 'forge') return;
      const { game, player } = ctx;
      if (player.forgeLevel >= cfg.costs.length) {
        note(ctx, t('NOTHING LEFT TO TEACH THIS BLADE'), COLORS.steel);
        return;
      }
      if (!spend(ctx, cfg.costs[player.forgeLevel])) return;
      player.forgeLevel++;
      player.applyForge();
      game.feel.sfx.play('unlock');
      game.feel.flash(0.15, COLORS.gold);
      game.feel.burst(player.cx, player.cy - 6, 16, {
        color: [COLORS.gold, COLORS.white], speed: 90, life: 0.5, drag: 3,
      });
      game.feel.text(player.cx, player.y - 12, t('FORGED +{n}', { n: player.forgeLevel }), COLORS.gold, 2);
    },
  };
}

/** The four conversation ids a quest-giver shows across a quest's life. */
export interface QuestStages {
  offer: string;
  progress: string;
  complete: string;
  done: string;
}

/**
 * Offers one quest and pays it out. The greeting tracks the quest's
 * state (offer → progress → complete → done); the choices carry
 * 'quest:accept' / 'quest:claim'. Bind any quest id to any NPC/sprite.
 */
export function questGiver(cfg: {
  name: string;
  sprite: LoadedSprite;
  anim?: string;
  quest: string;
  stages: QuestStages;
}): NpcDef {
  const { quest, stages } = cfg;
  return {
    name: cfg.name,
    sprite: cfg.sprite,
    anim: cfg.anim,
    greet: ({ player }) => {
      const q = player.quests;
      if (q.done.has(quest)) return stages.done;
      if (!q.started(quest)) return stages.offer;
      return q.isComplete(quest) ? stages.complete : stages.progress;
    },
    onChoice(choice, ctx) {
      const { game, player } = ctx;
      if (choice.action === 'quest:accept') {
        player.quests.start(quest);
        note(ctx, t('QUEST ACCEPTED'), COLORS.gold);
        game.sfx.play('menuSelect');
      } else if (choice.action === 'quest:claim') {
        const def = player.quests.turnIn(quest);
        if (!def) return;
        grantReward(player, def.reward);
        game.feel.sfx.play('levelup');
        game.feel.flash(0.2, COLORS.gold);
        game.feel.text(player.cx, player.y - 12, t('+{n} GOLD', { n: def.reward.gold ?? 0 }), COLORS.gold, 2);
      }
    },
  };
}
