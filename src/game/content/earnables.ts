import { defineEarnable } from '@engine/index';
import type { ActorHost } from '../defs';
import type { Player } from '../actors/player';

/**
 * Everything this game hands over permanently — the catalog behind
 * `Player.earned`.
 *
 * The engine supplies the ledger (`EarnedSet`) and knows nothing about
 * what an entry means. This file supplies the meaning, and `kind` is
 * where that meaning is declared. Three shapes are supported by the same
 * mechanism, which is the point:
 *
 * - `'ability'` — a bare verb with no inventory or skill-list presence.
 *   Nothing is projected; content simply asks `earned.has(id)`. The four
 *   boss verbs below are these.
 * - `'keyItem'` — an unlock the player CARRIES. Project it into the
 *   inventory with `onEarn`, and every existing item path (icons, the
 *   `props.key` door lock) works unchanged. Guard the add: `onEarn`
 *   re-runs on save restore and `Inventory.add` stacks, so an unguarded
 *   add would hand out a duplicate on every load.
 *
 *   ```ts
 *   defineEarnable<EarnCtx>('morph-ball', {
 *     name: 'MORPH BALL', desc: 'Curl into a sphere.', kind: 'keyItem',
 *     onEarn: ({ player }) => {
 *       if (!player.inventory.count('morph-ball')) player.inventory.add('morph-ball');
 *     },
 *   });
 *   ```
 *
 * - `'skill'` — a unique skill deliberately OFF the class tree, so it
 *   survives a class change (tree nodes do not). `SkillBook.learn` is
 *   already idempotent, so the projection replays safely as-is.
 *
 *   ```ts
 *   defineEarnable<EarnCtx>('tide-call', {
 *     name: 'TIDE CALL', desc: 'Summon the water to you.', kind: 'skill',
 *     onEarn: ({ player }) => player.skills.learn('tide-call'),
 *   });
 *   ```
 *
 * Which boss (or chest, or NPC) hands an entry over is declared where the
 * granting happens — see `MonsterDef.grants` — never by a branch here.
 */
export interface EarnCtx {
  game: ActorHost;
  player: Player;
}

/**
 * The four first-half boss verbs (docs/gameplay-progression.md). They are
 * `kind: 'ability'`: pure entries in the ledger, projecting nothing.
 * Registering one does not implement it — an unclaimed verb is simply
 * inert until player/environment code consumes `earned.has(...)`, which
 * is what lets ownership ship before the moves do.
 */
defineEarnable<EarnCtx>('impact-drop', {
  name: 'IMPACT DROP',
  desc: 'In the air, press down + attack to drive your fall into the ground.',
  kind: 'ability',
});

defineEarnable<EarnCtx>('wall-grip', {
  name: 'WALL GRIP',
  desc: 'Hold toward a wall in the air to cling to it, then jump to kick away.',
  kind: 'ability',
});

defineEarnable<EarnCtx>('air-step', {
  name: 'AIR STEP',
  desc: 'Press jump again in midair to step off the air itself.',
  kind: 'ability',
});

defineEarnable<EarnCtx>('shockwave', {
  name: 'SHOCKWAVE',
  desc: 'On the ground, press down + attack to send a wave through it.',
  kind: 'ability',
});

/** Importing this module registers the catalog. */
export function registerEarnables(): void {}
