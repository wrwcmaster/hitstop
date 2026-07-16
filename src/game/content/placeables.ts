import { Registry, type CollisionSource, type RoomEntity } from '@engine/index';
import { Monster, monsters } from '../actors/monster';
import { Npc, npcs } from '../actors/npc';
import type { ActionGame } from '../defs';

/**
 * Placeables: everything a room (or a tool) can put into the world, in
 * one catalog. Each entry knows how to spawn itself from a RoomEntity —
 * including its free-form `props` bag — plus what the level editor and
 * test spawner need to present it (label, category, colors, footprint).
 *
 * PlayScene.setRoom, the level editor's entity palette, and the test
 * spawner all consume THIS registry, so a new placeable kind (chest,
 * checkpoint, destructible, moving platform...) is one definePlaceable
 * call — none of those three sites change. Monsters and NPCs are bridged
 * in automatically from their own registries by registerPlaceables().
 */
export interface PlaceableCtx {
  game: ActionGame;
  tilemap: CollisionSource;
  /** Story flags, for shouldSpawn (a defeated boss stays defeated). */
  flags: ReadonlySet<string>;
}

export interface Placeable {
  /** Menu/palette label ("SLIME KING", "MERCHANT"). */
  label: string;
  /** Grouping for palettes and spawner menus ('enemy' | 'boss' | 'npc' | ...). */
  category: string;
  /** Swatch/marker colors (first entry is the chip). */
  colors: string[];
  /** Footprint in world px, for editor placement and markers. */
  w: number;
  h: number;
  /** Extra palette hint ("hp 4"). */
  hint?: string;
  /** Whether to spawn on this room visit (default yes). */
  shouldSpawn?(ctx: PlaceableCtx, e: RoomEntity): boolean;
  /** Create the entity in the world. `e.props` carries per-instance config. */
  spawn(ctx: PlaceableCtx, e: RoomEntity): void;
}

export const placeables = new Registry<Placeable>('placeable');

export function definePlaceable(id: string, def: Placeable): void {
  placeables.register(id, def);
}

/** All placeables of a category, for menus/palettes. */
export function placeablesIn(category: string): [string, Placeable][] {
  return placeables.entries().filter(([, p]) => p.category === category);
}

/**
 * Bridge the monster and NPC catalogs into the placeables registry.
 * Call once at bootstrap, after registerEnemies/registerBosses/
 * registerNpcs have filled their registries.
 */
export function registerPlaceables(): void {
  for (const id of monsters.ids()) {
    const def = monsters.get(id);
    definePlaceable(id, {
      label: (def.displayName ?? id).toUpperCase(),
      category: def.boss ? 'boss' : 'enemy',
      colors: def.colors,
      w: def.w,
      h: def.h,
      hint: `hp ${def.hp}`,
      // A defeated boss stays defeated across saves.
      shouldSpawn: ({ flags }) => !(def.boss && flags.has('bossDefeated')),
      spawn: ({ game, tilemap }, e) => {
        game.world.spawn(new Monster(id, game, tilemap, e.x, e.y));
      },
    });
  }
  for (const id of npcs.ids()) {
    const def = npcs.get(id);
    definePlaceable(id, {
      label: def.name,
      category: 'npc',
      colors: ['#94b0c2'],
      w: def.sprite.width - 2,
      h: def.sprite.height,
      spawn: ({ game, tilemap }, e) => {
        game.world.spawn(new Npc(id, game, tilemap, e.x, e.y));
      },
    });
  }
}
