import { loadSprite, loadSheet, loadImage, withFacing, type SpriteFile, type SheetDescriptor } from '@engine/index';
import { PAL } from './palette';
import knightJson from './sprites/knight.json';
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

function patchKnightJson(json: any) {
  const copy = JSON.parse(JSON.stringify(json));
  for (const animName of Object.keys(copy.anims)) {
    const anim = copy.anims[animName];
    for (let f = 0; f < anim.frames.length; f++) {
      const frame = anim.frames[f];
      
      let startPlume = 0;
      for (let y = 0; y < frame.length; y++) {
        if (frame[y].includes('3')) {
          startPlume = y;
          break;
        }
      }
      
      const helmetMask: Record<number, [number, number][]> = {
        7: [[16, 25]],
        8: [[16, 25]],
        9: [[14, 27]],
        10: [[12, 25], [28, 30]],
        11: [[12, 25], [28, 30]],
        12: [[11, 23], [26, 31]],
        13: [[10, 33]],
        14: [[10, 33]],
        15: [[9, 21]],
        16: [[9, 15]],
        17: [[9, 15]],
        18: [[9, 13], [16, 28]],
        19: [[9, 12], [14, 28]],
        20: [[9, 11], [13, 15]],
        21: [[9, 11], [13, 15]],
        22: [[9, 11], [13, 15]],
        23: [[9, 12], [14, 15], [19, 19]],
        24: [[9, 15], [21, 21]],
        25: [[10, 15], [19, 21]],
        26: [[10, 15], [19, 21]],
        27: [[10, 15], [19, 21]],
        28: [[11, 15]],
        29: [[13, 16]],
        30: [[13, 16]]
      };

      for (let y = 0; y < frame.length; y++) {
        let row = frame[y];
        let newRow = '';
        const relY = y - startPlume;
        
        for (let x = 0; x < row.length; x++) {
          let c = row[x];
          if (c === '3' && relY <= 9) {
            c = 'p';
          } 
          else if (helmetMask[relY]) {
            const ranges = helmetMask[relY];
            let inHelmet = false;
            for (const [minX, maxX] of ranges) {
              if (x >= minX && x <= maxX) {
                inHelmet = true;
                break;
              }
            }
            if (inHelmet) {
              if (c === '0') c = 'h';
              else if (c === '2') c = 'v';
              else if (c === '5') c = 's';
              else if (c === '1') c = 'o'; // helmet outline
            }
          }
          newRow += c;
        }
        frame[y] = newRow;
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

// Base Player (Unarmored tunic, clean cap/hood, skin, weapon)
const baseKnight = loadSprite(patchedKnightJson, {
  ...PAL,
  "0": "#86594c", "2": "#c69e8b", "3": "#5a535b", "5": "#323c39", // brown tunic/leather
  "h": null, "v": null, "p": null, "s": null, "o": null          // hide helmet
});
export const KNIGHT_UNARMORED_NO_HELMET_ANIMS = withFacing(baseKnight.animSet());

// Helmet Layer (Steel helmet only, transparent body)
const helmetKnight = loadSprite(patchedKnightJson, {
  ".": null,
  "0": null, "2": null, "3": null, "5": null, "1": null, "4": null, // hide body
  "h": "#6bcaea", "v": "#bcd1ce", "p": "#bf5749", "s": "#3f7299", "o": "#131014" // steel helmet
});
export const HELMET_ANIMS = withFacing(helmetKnight.animSet());

// Armor Layer (Steel body armor only, transparent head)
const armorKnight = loadSprite(patchedKnightJson, {
  ".": null,
  "0": "#6bcaea", "2": "#bcd1ce", "3": null, "5": "#3f7299", "1": "#131014", // steel armor
  "4": null,                                                                // hide skin
  "h": null, "v": null, "p": null, "s": null, "o": null                     // hide helmet
});
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
