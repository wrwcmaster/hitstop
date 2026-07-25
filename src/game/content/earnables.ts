import { earnableDef, defineEarnable } from '@engine/index';
import { t } from '@engine/index';
import { actionLabel, type ActionGame, type ActorHost, type Action } from '../defs';
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
  desc: 'In the air, {down} + {attack} drives your fall into the ground.',
  kind: 'ability',
});

defineEarnable<EarnCtx>('wall-grip', {
  name: 'WALL GRIP',
  desc: 'Hold toward a wall in the air to cling, then {jump} to kick away.',
  kind: 'ability',
});

defineEarnable<EarnCtx>('air-step', {
  name: 'AIR STEP',
  desc: 'Press {jump} again in midair to step off the air itself.',
  kind: 'ability',
});

defineEarnable<EarnCtx>('shockwave', {
  name: 'SHOCKWAVE',
  desc: 'On the ground, {down} + {attack} sends a wave through it.',
  kind: 'ability',
});

/** Importing this module registers the catalog. */
export function registerEarnables(): void {}

/**
 * An earnable's description with its input tokens filled in for whatever
 * device is in hand — `{jump}` becomes SPACE, or A on a pad, or the
 * on-screen button's own arrow on a phone. Catalog entries stay device-
 * agnostic (and translatable) because the substitution happens here, at
 * the moment something is shown, not where the text is written.
 */
export function abilityHint(game: ActionGame, id: string): string {
  const touch: Partial<Record<Action, string>> = {
    down: '\u25bc', jump: '\u25b2', attack: '\u2694',
  };
  return t(earnableDef(id).desc).replace(/\{(\w+)\}/g, (whole, name: string) => {
    const action = name as Action;
    return touch[action] === undefined && !ACTIONS.has(action)
      ? whole
      : actionLabel(game, action, touch[action]);
  });
}

/** The actions an ability hint may name. Anything else is left alone. */
const ACTIONS = new Set<Action>(['left', 'right', 'up', 'down', 'jump', 'attack', 'dash', 'parry', 'interact']);
