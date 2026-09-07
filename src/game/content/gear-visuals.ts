import { Registry, loadSprite, withFacing, type SpriteFile, type FacingAnimSet } from '@engine/index';
import { PAL } from './palette';
import ironHelmetJson from './sprites/equipment/iron-helmet.json';
import steelArmorJson from './sprites/equipment/steel-armor.json';
import { normalizedItemIcon } from './item-icon';

/**
 * Gear visuals: how an equipment ITEM draws on the knight. Each visual is
 * a sprite layer (same frame grid as the knight, transparent everywhere
 * the gear isn't) plus optional per-frame anchor offsets, composited over
 * the body in `order`. The player render just walks this registry — a new
 * visible slot (boots, cape, shield...) is a JSON sheet and one
 * defineGearVisual call, with no player-code changes. The item id is the
 * registry key; `slot` says where it must be equipped. Keying by slot used
 * to make a second helmet silently reuse the first helmet's art.
 *
 * Weapons use their own visual registry because they also own swing pose
 * and trails; see content/weapon-visuals.ts. Charms remain procedural.
 */
export interface GearAnchor {
  x: number;
  y: number;
  angle?: number;
}

export interface GearVisual {
  slot: string;
  anims: FacingAnimSet;
  icon: HTMLCanvasElement;
  /** anim name -> per-frame offsets (body-local px). Omitted = pinned at 0,0. */
  anchors?: Record<string, GearAnchor[]>;
  /** Compositing order; lower draws first (armor under helmet). */
  order: number;
  /** Foreground hand colors used to wrap a held weapon's grip. */
  grip?: { outline: string; fill: string; highlight: string };
}

/** Registered by equipment item id ('iron-helmet', 'steel-armor', ...). */
export const gearVisuals = new Registry<GearVisual>('gearVisual');

export function defineGearVisual(id: string, visual: GearVisual): void {
  gearVisuals.register(id, visual);
}

/** Equipped item visuals in draw order, resolved once per render. */
export function gearLayers(equipped: { get(slot: string): string | null }): [string, GearVisual][] {
  return gearVisuals
    .ids()
    .map((id): [string, GearVisual] => [id, gearVisuals.get(id)])
    .filter(([id, visual]) => equipped.get(visual.slot) === id)
    .sort((a, b) => a[1].order - b[1].order);
}

export function gearIcon(id: string): HTMLCanvasElement {
  return gearVisuals.get(id).icon;
}

const spriteGearConfigs = new Map<string, Omit<GearVisual, 'anims' | 'icon'>>();

function spriteGear(file: unknown, config: Omit<GearVisual, 'anims' | 'icon'>): GearVisual {
  const loaded = load(file);
  return {
    ...config,
    anims: withFacing(loaded.animSet()),
    icon: normalizedItemIcon(loaded.frame('idle')),
  };
}

function defineSpriteGear(id: string, file: unknown, config: Omit<GearVisual, 'anims' | 'icon'>): void {
  spriteGearConfigs.set(id, config);
  defineGearVisual(id, spriteGear(file, config));
}

/** Tooling seam: re-bake an in-memory equipment-layer edit. */
export function rebuildGearVisual(id: string, file: SpriteFile): boolean {
  const config = spriteGearConfigs.get(id);
  if (!config) return false;
  gearVisuals.replace(id, spriteGear(file, config));
  return true;
}

/** Show anchor crosshairs while positioning new gear art. */
export const DEBUG_ANCHORS = false;

const load = (file: unknown) => loadSprite(file as SpriteFile, PAL);

defineSpriteGear('steel-armor', steelArmorJson, {
  slot: 'armor',
  order: 0,
  grip: { outline: '#171625', fill: '#697c88', highlight: '#e7efea' },
});

defineSpriteGear('iron-helmet', ironHelmetJson, {
  slot: 'helmet',
  order: 1,
});
