import { loadSprite, withFacing, type SpriteFile } from '@engine/index';
import { PAL } from './palette';
import knightJson from './sprites/knight.json';
import slimeJson from './sprites/slime.json';
import batJson from './sprites/bat.json';
import merchantJson from './sprites/merchant.json';
import iconsJson from './sprites/icons.json';
import hudJson from './sprites/hud.json';

/**
 * Pixel art lives in per-sprite JSON files under `sprites/`, authored and
 * previewed in tools/sprite-editor.html and loaded here. Each file is a
 * palette + named animations of 1x text grids; `loadSprite` EPX-upscales
 * them TWICE to 4x texel density (iterated Scale2x) and bakes each frame.
 * This module just wires the loaded sprites to the names the game uses.
 */
export const TEXEL = 4;

/** Draw a TEXEL-density sprite at its logical (world) size, quantized to
 * the art's texel grid so motion steps are texel-fine, not world-pixel. */
export function blit(g: CanvasRenderingContext2D, img: HTMLCanvasElement, x: number, y: number): void {
  const q = (v: number) => Math.round(v * TEXEL) / TEXEL;
  g.drawImage(img, q(x), q(y), img.width / TEXEL, img.height / TEXEL);
}

const load = (file: unknown) => loadSprite(file as SpriteFile, PAL);

/* ---------------- knight ---------------- */

const knight = load(knightJson);
export const KNIGHT_ANIMS = withFacing(knight.animSet());
export const KNIGHT_IDLE_SPRITE = knight.frame('idle', 0);

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

/* ---------------- NPCs ---------------- */

export const MERCHANT = load(merchantJson).frame('idle');
