import { defineItem } from '@engine/index';
import { COLORS } from './palette';
import {
  ICON_POTION,
  ICON_ORB,
  ICON_CHARM,
  ICON_COIN,
  ICON_HASTE,
  ICON_KEY,
} from './sprites';
import type { ActorHost } from '../defs';
import type { Player } from '../actors/player';
import { weaponIcon } from './weapon-visuals';

/** Context handed to item use/onPickup hooks. */
export interface ItemCtx {
  game: ActorHost;
  player: Player;
}

defineItem<ItemCtx>('rusty-sword', {
  name: 'RUSTY SWORD',
  desc: 'A knight starts somewhere.',
  icon: weaponIcon('rusty-sword'),
  kind: 'equipment',
  slot: 'weapon',
});

defineItem<ItemCtx>('great-sword', {
  name: 'GREAT SWORD',
  desc: 'Slow heart, heavy hands.',
  icon: weaponIcon('great-sword'),
  kind: 'equipment',
  slot: 'weapon',
  mods: { add: { attack: 20 } },
});

defineItem<ItemCtx>('hunting-bow', {
  name: 'HUNTING BOW',
  desc: 'Arrows arc. Lead your mark.',
  icon: weaponIcon('hunting-bow'),
  kind: 'equipment',
  slot: 'weapon',
});

defineItem<ItemCtx>('flintlock', {
  name: 'FLINTLOCK',
  desc: 'One loud argument, slowly reloaded.',
  icon: weaponIcon('flintlock'),
  kind: 'equipment',
  slot: 'weapon',
});

defineItem<ItemCtx>('iron-helmet', {
  name: 'IRON HELMET',
  desc: 'Soaks 4 damage a blow. Dents until it splits.',
  icon: ICON_CHARM,
  kind: 'equipment',
  slot: 'helmet',
  // Armor SOAKS damage rather than padding the health pool (see
  // Player.mitigate). `durability` is how much total soaking the piece
  // survives before it breaks for good (Player.wearArmor).
  mods: { add: { armor: 4 } },
  props: { durability: 200 },
});

defineItem<ItemCtx>('potion', {
  name: 'POTION',
  desc: 'Restores 40 health.',
  icon: ICON_POTION,
  kind: 'consumable',
  stack: 5,
  use({ game, player }) {
    if (player.hp >= player.maxHp) return false; // don't waste it
    player.heal(40);
    game.feel.sfx.play('heal');
    game.feel.burst(player.cx, player.cy, 10, {
      color: [COLORS.red, COLORS.white], speed: 40, life: 0.5, grav: -60, drag: 3,
    });
  },
});

defineItem<ItemCtx>('mana-orb', {
  name: 'MANA ORB',
  desc: 'Restores 20 mana.',
  icon: ICON_ORB,
  kind: 'instant',
  onPickup({ game, player }) {
    player.restoreMp(20);
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

defineItem<ItemCtx>('gate-key', {
  name: 'GATE KEY',
  desc: 'Unlocks the arena gate.',
  icon: ICON_KEY,
  kind: 'key',
});

defineItem<ItemCtx>('steel-armor', {
  name: 'STEEL ARMOR',
  desc: 'Heavy plate. Soaks 8 damage a blow, until it gives.',
  icon: ICON_CHARM,
  kind: 'equipment',
  slot: 'armor',
  mods: { add: { armor: 8 } },
  props: { durability: 400 },
});

/** Importing this module registers the item catalog. */
export function registerItems(): void {}
