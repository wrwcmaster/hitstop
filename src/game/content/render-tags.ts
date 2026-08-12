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

for (const definition of renderTagDefs as PlayerRenderTagDef[]) {
  definePlayerRenderTag(definition.id, definition.label);
}
playerRenderTagOrder = (renderTagDefs as PlayerRenderTagDef[]).map((definition) => definition.id);

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
  const known = new Set(playerRenderTagOrder);
  if (!isLayeredSpriteFile(file)) {
    if (file.renderTag && !known.has(file.renderTag)) {
      throw new Error(`flat sprite uses unknown player render tag "${file.renderTag}"`);
    }
    return;
  }
  for (const layer of file.layers) {
    if (!known.has(layer.tag)) {
      throw new Error(`sprite layer "${layer.id}" uses unknown player render tag "${layer.tag}"`);
    }
  }
}
