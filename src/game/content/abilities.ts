import { Registry } from '@engine/index';

/**
 * World abilities: the permanent verbs a major boss hands over.
 *
 * These are deliberately NOT skill-tree capabilities. A tree node belongs
 * to a class, and changing class strips and replays every node's grants
 * (see `Player.setClass`) — which is right for a class kit and wrong for
 * a boss reward. Beating the first boss must not be undone by respeccing,
 * so ownership lives in its own set on the player (`Player.abilities`)
 * and is saved alongside the rest of the knight.
 *
 * One boss grants exactly one verb. The entries here are the catalog:
 * what the ability is called and how to explain it when it is earned.
 * WHICH boss grants WHICH ability is declared by the boss (`MonsterDef
 * .grants`), so a fifth reward is a content registration rather than
 * another branch in `PlayScene`.
 *
 * Registering the ability does not implement it: the verbs are consumed
 * by player/environment code as each lands. An owned-but-unconsumed
 * ability is inert, which is what lets ownership ship first.
 */
export interface WorldAbilityDef {
  /** Shown on the unlock banner and anywhere abilities are listed. */
  name: string;
  /** One line describing the verb, in the player's own terms. */
  desc: string;
  /** Sort order for any UI that lists earned abilities (low first). */
  order: number;
}

export const worldAbilities = new Registry<WorldAbilityDef>('worldAbility');

export function defineWorldAbility(id: string, def: WorldAbilityDef): void {
  worldAbilities.register(id, def);
}

defineWorldAbility('impact-drop', {
  name: 'IMPACT DROP',
  desc: 'In the air, press down + attack to drive your fall into the ground.',
  order: 1,
});

defineWorldAbility('wall-grip', {
  name: 'WALL GRIP',
  desc: 'Hold toward a wall in the air to cling to it, then jump to kick away.',
  order: 2,
});

defineWorldAbility('air-step', {
  name: 'AIR STEP',
  desc: 'Press jump again in midair to step off the air itself.',
  order: 3,
});

defineWorldAbility('shockwave', {
  name: 'SHOCKWAVE',
  desc: 'Send one wave of force running away through the ground.',
  order: 4,
});

/** Catalog order — the order earned abilities are listed and saved in. */
export function abilityOrder(): string[] {
  return worldAbilities
    .ids()
    .sort((a, b) => worldAbilities.get(a).order - worldAbilities.get(b).order);
}

/** Importing this module registers the ability catalog. */
export function registerAbilities(): void {}
