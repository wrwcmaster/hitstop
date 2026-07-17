/**
 * hitstop engine — public API.
 *
 * Games and tools import from '@engine' only; internal module paths are
 * free to move.
 */
export { Game, type GameOptions } from './core/game';
export { Loop, STEP, type LoopHooks } from './core/loop';
export { EventBus, type Unsubscribe } from './core/events';
export { Registry } from './core/registry';
export { JsonStore } from './core/storage';
export { SceneManager, type Scene } from './core/scene';

export * from './math/util';
export { type Rect, overlaps, containsPoint, centerX, centerY, expand } from './math/rect';

export { Input, Buffer } from './input/input';
export { GamepadInput, type GamepadMapping, type GamepadAxisMapping } from './input/gamepad';

export { createPixelCanvas, offscreen, type PixelCanvas } from './gfx/canvas';
export { sprite, epx, flipped, whiteOf, tintOf, type Palette, type SpriteData } from './gfx/sprite';
export { withFacing, frameAt, type Anim, type AnimSet, type FacingAnimSet } from './gfx/animation';
export {
  loadSprite,
  resolveSpriteGeometry,
  type SpriteFile,
  type SpriteGeometry,
  type SpriteAnimData,
  type LoadedSprite,
} from './gfx/spritefile';
export {
  loadSheet,
  loadImage,
  type SheetDescriptor,
  type SheetAnimData,
  type SheetRect,
} from './gfx/spritesheet';
export { drawText, textWidth, type TextAlign } from './gfx/font';
export { Camera } from './gfx/camera';

export { Feel, effects, defineEffect, type ImpactOptions, type NamedEffectDef } from './feel/feel';
export { Particles, type BurstOptions, type EffectDef, type EffectEmitter } from './feel/particles';
export { Floaters } from './feel/floaters';

export { AudioBus } from './audio/bus';
export { Sfx, type SoundFn } from './audio/sfx';
export { Music, songs, defineSong, noteHz, type SongDef, type SongTrack } from './audio/music';

export { statuses, defineStatus, Statuses, type StatusDef, type StatusHost } from './status/status';

export {
  Progression,
  SkillTree,
  treeNodes,
  defineTreeNode,
  treeNodeDef,
  type LevelCurve,
  type TreeNodeDef,
  type TreeHost,
} from './progression/progression';

export {
  applyGravity,
  moveAndCollide,
  GRAVITY,
  MAX_FALL,
  type Body,
  type Solid,
  type CollisionSource,
} from './physics/body';

export { Entity, Actor, type Team } from './world/entity';
export { World, type System } from './world/world';

export { Combat, Strike, type StrikeOptions, type HitInfo, type CombatEvents } from './combat/combat';
export { Projectile, type ProjectileOptions } from './combat/projectile';

export { FSM, type StateDef } from './fsm/fsm';

export { Tilemap, tiles, type TileDef } from './level/tilemap';
export { buildTilemap, validateRoom, type RoomDef, type RoomEntity } from './level/room';
export { Triggers, type TriggerDef, type TriggerFire } from './level/triggers';

export { Stats, type StatMods } from './items/stats';
export {
  items,
  defineItem,
  itemDef,
  Inventory,
  Equipment,
  type ItemDef,
  type ItemStack,
} from './items/items';

export { skills, defineSkill, skillDef, SkillBook, type SkillDef, type ResourcePool } from './skills/skills';

export { drawPanel, Menu, DEFAULT_PANEL, type MenuEntry, type MenuActions, type PanelStyle } from './ui/widgets';
export {
  conversations,
  defineConversation,
  DialogueScene,
  type ConversationDef,
  type ConversationLine,
  type ConversationChoice,
  type DialogueOptions,
} from './ui/dialogue';
export { Minimap, type MinimapMarker } from './ui/minimap';

export { DebugOverlay } from './debug/overlay';
