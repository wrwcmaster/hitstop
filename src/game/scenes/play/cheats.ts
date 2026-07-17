import { type Tilemap } from '@engine/index';
import { Monster } from '../../actors/monster';
import { COLORS } from '../../content/palette';
import type { ActionGame } from '../../defs';
import type { Player } from '../../actors/player';

/** What a cheat gets to work with (only live while the debug overlay is on). */
export interface CheatCtx {
  game: ActionGame;
  player: Player;
  tilemap: Tilemap;
  /** Floater over the player's head. */
  say(text: string, color?: string): void;
}

export interface Cheat {
  /** KeyboardEvent.code that fires it. */
  code: string;
  /** Legend line ("1 gold"). */
  label: string;
  run(ctx: CheatCtx): void;
}

/**
 * Debug cheats as data: the key handler and the on-screen legend both walk
 * this table, so adding a cheat is one entry — nothing else to update.
 */
export const CHEATS: Cheat[] = [
  { code: 'Digit1', label: '1 gold', run: ({ player, say }) => { player.gold += 100; say('GOLD +100'); } },
  { code: 'Digit2', label: '2 xp', run: ({ player }) => player.gainXp(100) }, // gainXp shows its own floater
  {
    code: 'Digit3', label: '3 skill',
    run: ({ player, say }) => { player.progression.skillPoints += 3; say('SKILL +3', COLORS.blue); },
  },
  {
    code: 'Digit4', label: '4 heal',
    run: ({ game, player, say }) => {
      player.hp = player.maxHp;
      player.mp = player.maxMp;
      game.feel.flash(0.12, COLORS.white);
      say('FULL HEAL', COLORS.red);
    },
  },
  {
    code: 'Digit5', label: '5 god',
    run: ({ player, say }) => { player.godMode = !player.godMode; say(player.godMode ? 'GOD ON' : 'GOD OFF'); },
  },
  {
    code: 'Digit6', label: '6 gear',
    run: ({ player, say }) => {
      for (const id of ['great-sword', 'iron-helmet', 'potion', 'potion', 'haste-draught']) player.inventory.add(id);
      say('GEAR GRANTED');
    },
  },
  {
    code: 'Digit7', label: '7 kill',
    run: ({ game, player, say }) => {
      for (const en of game.world.actors('enemy')) {
        if (en instanceof Monster) {
          game.combat.hit(en, {
            damage: 9999, targets: 'enemy', attacker: player, strength: 0.6, colors: [COLORS.white],
          });
        }
      }
      say('KILL ALL', COLORS.red);
    },
  },
  {
    code: 'Digit8', label: '8 devourer',
    run: ({ game, player, tilemap, say }) => {
      game.world.spawn(new Monster('devourer', game, tilemap, player.cx + 34, player.cy - 24));
      say('DEVOURER', COLORS.purple);
    },
  },
  {
    code: 'Digit0', label: '0 boom',
    run: ({ game, player }) => {
      game.feel.effect(player.cx + player.facing * 28, player.cy, 'explosion');
    },
  },
  {
    code: 'Digit9', label: '9 equip',
    run: ({ player, say }) => {
      // Cycle helmet → armor → both → none, granting pieces as needed.
      const hasHelmet = player.equipment.get('helmet') !== null;
      const hasArmor = player.equipment.get('armor') !== null;
      const wear = (id: string) => {
        player.inventory.add(id);
        player.equipment.equip(id);
      };
      if (!hasHelmet && !hasArmor) {
        wear('iron-helmet');
        say('EQUIP: HELMET');
      } else if (hasHelmet && !hasArmor) {
        player.equipment.unequip('helmet');
        wear('steel-armor');
        say('EQUIP: ARMOR');
      } else if (!hasHelmet && hasArmor) {
        wear('iron-helmet');
        say('EQUIP: HELMET & ARMOR');
      } else {
        player.equipment.unequip('helmet');
        player.equipment.unequip('armor');
        say('UNEQUIP ALL');
      }
    },
  },
];

/** The cheat bound to a KeyboardEvent.code, if any. */
export function cheatFor(code: string): Cheat | undefined {
  return CHEATS.find((c) => c.code === code);
}
