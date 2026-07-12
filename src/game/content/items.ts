import { defineItem, itemDef } from '@engine/index';
import { COLORS } from './palette';
import {
  ICON_SWORD,
  ICON_GREATSWORD,
  ICON_POTION,
  ICON_ORB,
  ICON_CHARM,
  ICON_COIN,
  ICON_HASTE,
} from './sprites';
import type { ActionGame } from '../defs';
import type { Player } from '../actors/player';

/** Context handed to item use/onPickup hooks. */
export interface ItemCtx {
  game: ActionGame;
  player: Player;
}

/**
 * The item catalog. Weapons are equipment whose `props.weapon` carries an
 * attack spec the player's swing reads — so weapon variety needs no
 * player-code changes.
 */
export interface WeaponSpec {
  lightDamage: number;
  heavyDamage: number;
  lightStrength: number;
  heavyStrength: number;
  /** Extra hitbox size in px over bare fists. */
  reach: number;
  /** Slash/impact particle colors. */
  colors: string[];
}

export function weaponSpecOf(itemId: string | null): WeaponSpec {
  const fallback: WeaponSpec = {
    lightDamage: 1, heavyDamage: 1, lightStrength: 0.3, heavyStrength: 0.5,
    reach: -6, colors: [COLORS.white],
  };
  if (!itemId) return fallback;
  return (itemDef(itemId).props?.weapon as WeaponSpec) ?? fallback;
}

defineItem<ItemCtx>('rusty-sword', {
  name: 'RUSTY SWORD',
  desc: 'A knight starts somewhere.',
  icon: ICON_SWORD,
  kind: 'equipment',
  slot: 'weapon',
  props: {
    weapon: {
      lightDamage: 1, heavyDamage: 2, lightStrength: 0.45, heavyStrength: 0.8,
      reach: 0, colors: [COLORS.white, COLORS.gold],
    } satisfies WeaponSpec,
  },
});

defineItem<ItemCtx>('great-sword', {
  name: 'GREAT SWORD',
  desc: 'Slow heart, heavy hands.',
  icon: ICON_GREATSWORD,
  kind: 'equipment',
  slot: 'weapon',
  mods: { add: { attack: 1 } },
  props: {
    weapon: {
      lightDamage: 2, heavyDamage: 4, lightStrength: 0.6, heavyStrength: 1.0,
      reach: 5, colors: [COLORS.gold, COLORS.white, COLORS.red],
    } satisfies WeaponSpec,
  },
});

defineItem<ItemCtx>('iron-charm', {
  name: 'IRON CHARM',
  desc: 'Two more hearts of stubbornness.',
  icon: ICON_CHARM,
  kind: 'equipment',
  slot: 'charm',
  mods: { add: { maxHp: 2 } },
});

defineItem<ItemCtx>('potion', {
  name: 'POTION',
  desc: 'Restores 2 hearts.',
  icon: ICON_POTION,
  kind: 'consumable',
  stack: 5,
  use({ game, player }) {
    if (player.hp >= player.maxHp) return false; // don't waste it
    player.heal(2);
    game.feel.sfx.play('heal');
    game.feel.burst(player.cx, player.cy, 10, {
      color: [COLORS.red, COLORS.white], speed: 40, life: 0.5, grav: -60, drag: 3,
    });
  },
});

defineItem<ItemCtx>('mana-orb', {
  name: 'MANA ORB',
  desc: 'Restores 1 mana.',
  icon: ICON_ORB,
  kind: 'instant',
  onPickup({ game, player }) {
    player.restoreMp(1);
    game.feel.burst(player.cx, player.cy - 6, 6, {
      color: [COLORS.blue, COLORS.white], speed: 40, life: 0.4, grav: -40, drag: 3,
    });
  },
});

defineItem<ItemCtx>('coin', {
  name: 'COIN',
  desc: 'The merchant accepts these.',
  icon: ICON_COIN,
  kind: 'instant',
  onPickup({ game, player }) {
    player.gold += 5;
    game.events.emit('score', { points: 25, x: player.cx, y: player.y - 8 });
    game.feel.sfx.play('coin');
  },
});

defineItem<ItemCtx>('haste-draught', {
  name: 'HASTE DRAUGHT',
  desc: 'Move like the wind for 6 seconds.',
  icon: ICON_HASTE,
  kind: 'consumable',
  stack: 3,
  use({ game, player }) {
    player.statuses.apply('haste');
    game.feel.sfx.play('heal');
  },
});

/** Importing this module registers the item catalog. */
export function registerItems(): void {}
