import { Registry, isLayeredSpriteFile, type SpriteFile } from '@engine/index';
import renderTagDefs from './render-tags.json';

/**
 * Shared render bands for a player composite. Tags are content, not engine
 * concepts: sprites name the band each authored layer contributes to, and
 * the player renderer walks this registry in insertion order.
 */
export interface PlayerRenderTag {
  label: string;
}

export interface PlayerRenderTagDef extends PlayerRenderTag {
  id: string;
}

export const playerRenderTags = new Registry<PlayerRenderTag>('playerRenderTag');
let playerRenderTagOrder: string[] = [];

export function definePlayerRenderTag(id: string, label: string): void {
  playerRenderTags.register(id, { label });
}

export const BODY_RENDER_TAG = 'body';
export const HELD_OBJECT_RENDER_TAG = 'held-object';
export const FOREGROUND_BODY_RENDER_TAG = 'foreground-body';

for (const definition of renderTagDefs as PlayerRenderTagDef[]) {
  definePlayerRenderTag(definition.id, definition.label);
}
playerRenderTagOrder = (renderTagDefs as PlayerRenderTagDef[]).map((definition) => definition.id);

// These fallback bands are referenced by gameplay defaults. The foreground
// body band is optional: authored hand layers may use it, while procedural
// grips fall back to the frontmost configured band when it is absent.
for (const required of [BODY_RENDER_TAG, HELD_OBJECT_RENDER_TAG]) {
  if (!playerRenderTags.has(required)) throw new Error(`player render tags need "${required}"`);
}

export function orderedPlayerRenderTags(): string[] {
  return [...playerRenderTagOrder];
}

/** Update the live content registry for authoring previews and hot reload. */
export function configurePlayerRenderTags(definitions: readonly PlayerRenderTagDef[]): void {
  for (const definition of definitions) playerRenderTags.replace(definition.id, { label: definition.label });
  playerRenderTagOrder = definitions.map((definition) => definition.id);
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
