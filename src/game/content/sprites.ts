import { loadSprite, loadSheet, loadImage, withFacing, type SpriteFile, type SheetDescriptor } from '@engine/index';
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

/** Programmatically splits head/helmet and body indices so they can be colored independently. */
function patchKnightJson(json: any) {
  const copy = JSON.parse(JSON.stringify(json));
  for (const animName of Object.keys(copy.anims)) {
    const anim = copy.anims[animName];
    for (let f = 0; f < anim.frames.length; f++) {
      const frame = anim.frames[f];
      
      // Find the first row containing '3' (the plume) to determine vertical offset
      let startPlume = 0;
      for (let y = 0; y < frame.length; y++) {
        if (frame[y].includes('3')) {
          startPlume = y;
          break;
        }
      }
      
      const plumeEnd = startPlume + 6;
      const helmetStart = startPlume + 7;
      const helmetEnd = startPlume + 14;

      for (let y = 0; y < frame.length; y++) {
        let row = frame[y];
        // Plume area
        if (y >= startPlume && y <= plumeEnd) {
          row = row.replace(/3/g, 'p');
        }
        // Helmet/Visor area (columns 12 to end of row)
        if (y >= helmetStart && y <= helmetEnd) {
          const prefix = row.slice(0, 12);
          const helmetPart = row.slice(12);
          const patchedHelmet = helmetPart
            .replace(/0/g, 'h') // helmet plate -> h
            .replace(/2/g, 'v') // helmet visor details -> v
            .replace(/3/g, 'p'); // plume on head -> p
          row = prefix + patchedHelmet;
        }
        frame[y] = row;
      }
    }
  }
  return copy;
}

const patchedKnightJson = patchKnightJson(knightJson);

// Delete base palette keys from patchedKnightJson so they do not overwrite base configurations in loadSprite
delete (patchedKnightJson.palette as any)["0"];
delete (patchedKnightJson.palette as any)["2"];
delete (patchedKnightJson.palette as any)["3"];
delete (patchedKnightJson.palette as any)["5"];

// 1. Armored Body + Helmet
const fullKnight = loadSprite(patchedKnightJson, {
  ...PAL,
  "0": "#6bcaea", "2": "#bcd1ce", "3": "#bf5749", "5": "#3f7299", // body
  "h": "#6bcaea", "v": "#bcd1ce", "p": "#bf5749", // head (matching steel armor)
});
export const KNIGHT_ARMORED_WITH_HELMET_ANIMS = withFacing(fullKnight.animSet());

// 2. Armored Body + No Helmet (weathered cap & cloak hood)
const armoredNoHelmet = loadSprite(patchedKnightJson, {
  ...PAL,
  "0": "#6bcaea", "2": "#bcd1ce", "3": "#bf5749", "5": "#3f7299", // body
  "h": "#86594c", "v": "#c69e8b", "p": "#5a535b", // head (no steel helmet)
});
export const KNIGHT_ARMORED_NO_HELMET_ANIMS = withFacing(armoredNoHelmet.animSet());

// 3. Unarmored Body + Helmet
const unarmoredWithHelmet = loadSprite(patchedKnightJson, {
  ...PAL,
  "0": "#86594c", "2": "#c69e8b", "3": "#5a535b", "5": "#323c39", // body
  "h": "#6bcaea", "v": "#bcd1ce", "p": "#bf5749", // head (matching steel helmet)
});
export const KNIGHT_UNARMORED_WITH_HELMET_ANIMS = withFacing(unarmoredWithHelmet.animSet());

// 4. Unarmored Body + No Helmet (Default starting look)
const unarmoredNoHelmetSheet = loadSprite(patchedKnightJson, {
  ...PAL,
  "0": "#86594c", "2": "#c69e8b", "3": "#5a535b", "5": "#323c39", // body
  "h": "#86594c", "v": "#c69e8b", "p": "#5a535b", // head (no steel helmet)
});
export const KNIGHT_UNARMORED_NO_HELMET_ANIMS = withFacing(unarmoredNoHelmetSheet.animSet());

// We keep these exported variables for backward compatibility and live bindings
export let KNIGHT_ANIMS = KNIGHT_UNARMORED_NO_HELMET_ANIMS; // default to unarmored at start
export let KNIGHT_IDLE_SPRITE = unarmoredNoHelmetSheet.frame('idle', 0); // default to unarmored first frame

/**
 * Swap the knight to a PNG sprite sheet (see tools/sheet-slicer.html and
 * docs/design-tools.md). Call from main.ts boot with the sheet image URL
 * (a Vite `import x from './knight.png'`) and its exported descriptor:
 *
 *   await loadKnightSheet(knightPngUrl, knightSheetDescriptor);
 *
 * The idle animation's first frame becomes the title/menu portrait.
 */
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
