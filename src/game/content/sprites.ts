import { loadSprite, loadSheet, loadImage, withFacing, type SpriteFile, type SheetDescriptor } from '@engine/index';
import { PAL } from './palette';
import knightJson from './sprites/knight.json';
import ironHelmetJson from './sprites/equipment/iron-helmet.json';
import steelArmorJson from './sprites/equipment/steel-armor.json';
import slimeJson from './sprites/slime.json';
import batJson from './sprites/bat.json';
import merchantJson from './sprites/merchant.json';
import iconsJson from './sprites/icons.json';
import hudJson from './sprites/hud.json';

export const TEXEL = 4;

export function blit(g: CanvasRenderingContext2D, img: HTMLCanvasElement, x: number, y: number): void {
  const q = (v: number) => Math.round(v * TEXEL) / TEXEL;
  g.drawImage(img, q(x), q(y), img.width / TEXEL, img.height / TEXEL);
}

const load = (file: unknown) => loadSprite(file as SpriteFile, PAL);

/* ---------------- knight ---------------- */

export interface EquipmentAnchor {
  x: number;
  y: number;
  angle?: number;
}

// Visual debug flag for positioning anchors
export const DEBUG_ANCHORS = false;

// Default offsets since layers are pre-aligned (0, 0)
const DEFAULT_ANCHOR = { x: 0, y: 0, angle: 0 };

export const HEAD_ANCHORS: Record<string, EquipmentAnchor[]> = {
  idle: [DEFAULT_ANCHOR],
  run: [DEFAULT_ANCHOR, DEFAULT_ANCHOR, DEFAULT_ANCHOR, DEFAULT_ANCHOR],
  air: [DEFAULT_ANCHOR],
  attack: [DEFAULT_ANCHOR, DEFAULT_ANCHOR, DEFAULT_ANCHOR, DEFAULT_ANCHOR]
};

export const CHEST_ANCHORS: Record<string, EquipmentAnchor[]> = {
  idle: [DEFAULT_ANCHOR],
  run: [DEFAULT_ANCHOR, DEFAULT_ANCHOR, DEFAULT_ANCHOR, DEFAULT_ANCHOR],
  air: [DEFAULT_ANCHOR],
  attack: [DEFAULT_ANCHOR, DEFAULT_ANCHOR, DEFAULT_ANCHOR, DEFAULT_ANCHOR]
};

// Base Player (Unarmored tunic, clean cap/hood, skin, weapon)
const baseKnight = load(knightJson);
export const KNIGHT_UNARMORED_NO_HELMET_ANIMS = withFacing(baseKnight.animSet());

// Helmet Layer (Steel helmet only, transparent body)
const helmetKnight = load(ironHelmetJson);
export const HELMET_ANIMS = withFacing(helmetKnight.animSet());

// Armor Layer (Steel body armor only, transparent head)
const armorKnight = load(steelArmorJson);
export const ARMOR_ANIMS = withFacing(armorKnight.animSet());

// Backward-compatible alias exports for rest of codebase
export const KNIGHT_ARMORED_WITH_HELMET_ANIMS = KNIGHT_UNARMORED_NO_HELMET_ANIMS;
export const KNIGHT_ARMORED_NO_HELMET_ANIMS = KNIGHT_UNARMORED_NO_HELMET_ANIMS;
export const KNIGHT_UNARMORED_WITH_HELMET_ANIMS = KNIGHT_UNARMORED_NO_HELMET_ANIMS;

export let KNIGHT_ANIMS = KNIGHT_UNARMORED_NO_HELMET_ANIMS;
export let KNIGHT_IDLE_SPRITE = baseKnight.frame('idle', 0);

export async function loadKnightSheet(imageUrl: string, desc: SheetDescriptor): Promise<void> {
  const img = await loadImage(imageUrl);
  const sheet = loadSheet(img, desc);
  KNIGHT_ANIMS = withFacing(sheet.animSet());
  KNIGHT_IDLE_SPRITE = sheet.frame('idle', 0);
}

/* ---------------- enemies ---------------- */

const slime = load(slimeJson);
export const SLIME1 = slime.frame('idle', 0);
export const SLIME2 = slime.frame('idle', 1);

const bat = load(batJson);
export const BAT1 = bat.frame('fly', 0);
export const BAT2 = bat.frame('fly', 1);

/* ---------------- HUD ---------------- */

const hud = load(hudJson);
export const HEART = hud.frame('heart');
export const HEART_EMPTY = hud.frame('heartEmpty');
export const MANA_PIP = hud.frame('manaPip');
export const MANA_PIP_EMPTY = hud.frame('manaPipEmpty');

/* ---------------- item icons ---------------- */

const icons = load(iconsJson);
export const ICON_SWORD = icons.frame('sword');
export const ICON_GREATSWORD = icons.frame('greatsword');
export const ICON_POTION = icons.frame('potion');
export const ICON_ORB = icons.frame('orb');
export const ICON_CHARM = icons.frame('charm');
export const ICON_COIN = icons.frame('coin');
export const ICON_HASTE = icons.frame('haste');
export const ICON_KEY = icons.frame('key');

/* ---------------- NPCs ---------------- */

export const MERCHANT = load(merchantJson).frame('idle');
