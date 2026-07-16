import { Registry, loadSprite, withFacing, type SpriteFile, type FacingAnimSet } from '@engine/index';
import { PAL } from './palette';
import ironHelmetJson from './sprites/equipment/iron-helmet.json';
import steelArmorJson from './sprites/equipment/steel-armor.json';

/**
 * Gear visuals: how an equipment SLOT draws on the knight. Each visual is
 * a sprite layer (same frame grid as the knight, transparent everywhere
 * the gear isn't) plus optional per-frame anchor offsets, composited over
 * the body in `order`. The player render just walks this registry — a new
 * visible slot (boots, cape, shield...) is a JSON sheet and one
 * defineGearVisual call, with no player-code changes.
 *
 * Weapons and charms stay procedural (drawn in-hand / orbiting), so they
 * are not layers here.
 */
export interface GearAnchor {
  x: number;
  y: number;
  angle?: number;
}

export interface GearVisual {
  anims: FacingAnimSet;
  /** anim name -> per-frame offsets (body-local px). Omitted = pinned at 0,0. */
  anchors?: Record<string, GearAnchor[]>;
  /** Compositing order; lower draws first (armor under helmet). */
  order: number;
}

/** Registered by equipment SLOT id ('helmet', 'armor', ...). */
export const gearVisuals = new Registry<GearVisual>('gearVisual');

export function defineGearVisual(slot: string, visual: GearVisual): void {
  gearVisuals.register(slot, visual);
}

/** Slots in draw order, resolved once per frame by the player render. */
export function gearLayers(): [string, GearVisual][] {
  return gearVisuals
    .ids()
    .map((slot): [string, GearVisual] => [slot, gearVisuals.get(slot)])
    .sort((a, b) => a[1].order - b[1].order);
}

/** Show anchor crosshairs while positioning new gear art. */
export const DEBUG_ANCHORS = false;

const load = (file: unknown) => loadSprite(file as SpriteFile, PAL);

defineGearVisual('armor', {
  anims: withFacing(load(steelArmorJson).animSet()),
  order: 0,
});

defineGearVisual('helmet', {
  anims: withFacing(load(ironHelmetJson).animSet()),
  order: 1,
});
