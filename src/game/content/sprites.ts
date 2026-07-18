import { loadSprite, loadSheet, loadImage, withFacing, type SpriteFile, type SheetDescriptor } from '@engine/index';
import { PAL } from './palette';
import knightJson from './sprites/knight.json';
import slimeJson from './sprites/slime.json';
import batJson from './sprites/bat.json';
import pikeJson from './sprites/pike.json';
import chestJson from './sprites/chest.json';
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

// The bare (unarmored) knight. Visible equipment composites on top as
// layers — see content/gear-visuals.ts — so there's exactly one body
// sprite regardless of loadout.
// Live bindings let a PNG sheet replace both the art and its geometry at
// boot; consumers should not retain a snapshot of this object.
export let baseKnight = load(knightJson);
export let KNIGHT_ANIMS = withFacing(baseKnight.animSet());
export let KNIGHT_IDLE_SPRITE = baseKnight.frame('idle', 0);

export async function loadKnightSheet(imageUrl: string, desc: SheetDescriptor): Promise<void> {
  const img = await loadImage(imageUrl);
  const sheet = loadSheet(img, desc);
  baseKnight = sheet;
  KNIGHT_ANIMS = withFacing(sheet.animSet());
  KNIGHT_IDLE_SPRITE = sheet.frame('idle', 0);
}

/* ---------------- enemies ---------------- */

export const slimeSprite = load(slimeJson);
export const SLIME1 = slimeSprite.frame('idle', 0);
export const SLIME2 = slimeSprite.frame('idle', 1);

export const pikeSprite = load(pikeJson);
export const PIKE1 = pikeSprite.frame('swim', 0);
export const PIKE2 = pikeSprite.frame('swim', 1);

export const chestSprite = load(chestJson);
export const CHEST = chestSprite.frame('idle', 0);

export const batSprite = load(batJson);
export const BAT1 = batSprite.frame('fly', 0);
export const BAT2 = batSprite.frame('fly', 1);

/* ---------------- HUD ---------------- */

const hud = load(hudJson);
export const HEART = hud.frame('heart');
export const HEART_EMPTY = hud.frame('heartEmpty');
export const MANA_PIP = hud.frame('manaPip');
export const MANA_PIP_EMPTY = hud.frame('manaPipEmpty');

/* ---------------- item icons ---------------- */

const icons = load(iconsJson);
export const ICON_POTION = icons.frame('potion');
export const ICON_ORB = icons.frame('orb');
export const ICON_CHARM = icons.frame('charm');
export const ICON_COIN = icons.frame('coin');
export const ICON_HASTE = icons.frame('haste');
export const ICON_KEY = icons.frame('key');

/* ---------------- NPCs ---------------- */

export const merchantSprite = load(merchantJson);
export const MERCHANT = merchantSprite.frame('idle');
