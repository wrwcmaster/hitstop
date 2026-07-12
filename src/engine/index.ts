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
export { SceneManager, type Scene } from './core/scene';

export * from './math/util';
export { type Rect, overlaps, containsPoint, centerX, centerY, expand } from './math/rect';

export { Input, Buffer } from './input/input';

export { createPixelCanvas, offscreen, type PixelCanvas } from './gfx/canvas';
export { sprite, flipped, whiteOf, tintOf, type Palette, type SpriteData } from './gfx/sprite';
export { withFacing, frameAt, type Anim, type AnimSet, type FacingAnimSet } from './gfx/animation';
export { drawText, textWidth, type TextAlign } from './gfx/font';
export { Camera } from './gfx/camera';

export { Feel, type ImpactOptions } from './feel/feel';
export { Particles, type BurstOptions } from './feel/particles';
export { Floaters } from './feel/floaters';

export { Sfx, type SoundFn } from './audio/sfx';

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

export { FSM, type StateDef } from './fsm/fsm';

export { Tilemap, tiles, type TileDef } from './level/tilemap';
export { buildTilemap, validateRoom, type RoomDef, type RoomEntity } from './level/room';

export { DebugOverlay } from './debug/overlay';
