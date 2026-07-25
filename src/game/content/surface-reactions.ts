import { Registry, type TileRef } from '@engine/index';
import type { PlayHost } from '../scenes/play/host';
import { COLORS } from './palette';

/**
 * What a surface DOES when force reaches it.
 *
 * Tiles carry generic `traits` — `breakable`, `resonant`, `rebound` —
 * and the engine has no idea what any of them mean. This registry is
 * where they acquire meaning, keyed by trait, so a verb that hits the
 * ground never names a tile id and a tile never names a verb. Adding a
 * reacting surface is one `defineSurfaceReaction` call plus the trait on
 * the tile; no verb changes.
 *
 * Two verbs feed it, and the `by` field is how a reaction can tell them
 * apart when it cares: Impact Drop strikes straight down onto the tiles
 * under the knight's feet, Shockwave runs along the top of a surface.
 */
export type SurfaceForce = 'plunge' | 'wave';

export interface SurfaceReactionCtx {
  host: PlayHost;
  tile: TileRef;
  by: SurfaceForce;
}

export interface SurfaceReaction {
  /** Which verbs this answers. Absent = all of them. */
  to?: readonly SurfaceForce[];
  /** Return true if anything actually happened (drives one-shot feedback). */
  react(ctx: SurfaceReactionCtx): boolean;
}

export const surfaceReactions = new Registry<SurfaceReaction>('surface reaction');

export function defineSurfaceReaction(trait: string, def: SurfaceReaction): void {
  surfaceReactions.register(trait, def);
}

/**
 * Run every reaction this tile's traits ask for. Returns true if any of
 * them did something, so the caller can play ONE sound for a burst
 * rather than one per tile.
 */
export function reactToSurface(host: PlayHost, tile: TileRef, by: SurfaceForce): boolean {
  let acted = false;
  for (const trait of tile.def.traits ?? []) {
    if (!surfaceReactions.has(trait)) continue;
    const reaction = surfaceReactions.get(trait);
    if (reaction.to && !reaction.to.includes(by)) continue;
    if (reaction.react({ host, tile, by })) acted = true;
  }
  return acted;
}

/**
 * Weak stone gives way — to a body dropped on it or a wave run through
 * it, which is why one trait serves both verbs. `mutateTile` (not
 * `tilemap.setTile`) so the hole survives leaving the room and reloading.
 */
defineSurfaceReaction('breakable', {
  react({ host, tile }) {
    if (tile.id === '') return false;
    host.mutateTile(tile.tx, tile.ty, '');
    host.game.feel.burst(tile.rect.x + tile.rect.w / 2, tile.rect.y + tile.rect.h / 2, 9, {
      color: [COLORS.steel, COLORS.white, COLORS.navyLight],
      speed: 90, life: 0.45, spread: Math.PI * 2, drag: 2.4, grav: 320,
    });
    return true;
  },
});

/** Importing this module registers the catalog. */
export function registerSurfaceReactions(): void {}
