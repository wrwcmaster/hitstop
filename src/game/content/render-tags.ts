import { Registry, isLayeredSpriteFile, type SpriteFile } from '@engine/index';

/**
 * Shared render bands for a player composite. Tags are content, not engine
 * concepts: sprites name the band each authored layer contributes to, and
 * the player renderer walks this registry in insertion order.
 */
export interface PlayerRenderTag {
  label: string;
}

export const playerRenderTags = new Registry<PlayerRenderTag>('playerRenderTag');

export function definePlayerRenderTag(id: string, label: string): void {
  playerRenderTags.register(id, { label });
}

export const BODY_RENDER_TAG = 'body';
export const HELD_OBJECT_RENDER_TAG = 'held-object';
export const FOREGROUND_BODY_RENDER_TAG = 'foreground-body';

definePlayerRenderTag('behind-body', 'Behind body');
definePlayerRenderTag(BODY_RENDER_TAG, 'Body');
definePlayerRenderTag(HELD_OBJECT_RENDER_TAG, 'Held object');
definePlayerRenderTag(FOREGROUND_BODY_RENDER_TAG, 'Foreground body');
definePlayerRenderTag('foreground-effects', 'Foreground effects');

export function orderedPlayerRenderTags(): string[] {
  return playerRenderTags.ids();
}

/** Fail at content load instead of silently dropping a mistagged layer. */
export function validatePlayerRenderTags(file: SpriteFile): void {
  if (!isLayeredSpriteFile(file)) return;
  for (const layer of file.layers) {
    if (!playerRenderTags.has(layer.tag)) {
      throw new Error(`sprite layer "${layer.id}" uses unknown player render tag "${layer.tag}"`);
    }
  }
}
