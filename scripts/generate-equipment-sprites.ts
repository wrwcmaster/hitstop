/**
 * One-time generator: extract equipment sprite frames from knight.json.
 * 
 * Reads the original knight.json (full armored knight) and uses the helmet
 * mask to produce:
 *   - iron-helmet.json  — only helmet pixels, body transparent
 *   - steel-armor.json  — only body armor pixels, head transparent
 * 
 * Run once:  npx tsx scripts/generate-equipment-sprites.ts
 */
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SPRITES_DIR = path.resolve(__dirname, '../src/game/content/sprites');
const EQUIP_DIR = path.join(SPRITES_DIR, 'equipment');

const knightJson = JSON.parse(fs.readFileSync(path.join(SPRITES_DIR, 'knight.json'), 'utf8'));

// The helmet mask: defines which pixel coordinates belong to the helmet
// region relative to the plume anchor row.
const helmetMask: Record<number, [number, number][]> = {
  7:  [[16, 25]],
  8:  [[16, 25]],
  9:  [[14, 27]],
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

// Characters that are part of the body armor (not skin, not outline, not transparent)
const BODY_ARMOR_CHARS = new Set(['0', '2', '5']);
// Characters that are part of the helmet (same chars, but in the helmet region)
const HELMET_CHARS = new Set(['0', '2', '5']);
// The plume character
const PLUME_CHAR = '3';
const PLUME_MAX_REL_Y = 9;

function isInHelmetRegion(x: number, relY: number): boolean {
  const ranges = helmetMask[relY];
  if (!ranges) return false;
  for (const [minX, maxX] of ranges) {
    if (x >= minX && x <= maxX) return true;
  }
  return false;
}

function findPlumeStart(frame: string[]): number {
  for (let y = 0; y < frame.length; y++) {
    if (frame[y].includes(PLUME_CHAR)) return y;
  }
  return 0;
}

// Generate helmet sprite frames
function extractHelmetFrames(anims: any): any {
  const result: any = {};
  
  for (const [animName, animData] of Object.entries(anims) as [string, any][]) {
    const newFrames: string[][] = [];
    
    for (const frame of animData.frames) {
      const startPlume = findPlumeStart(frame);
      const newFrame: string[] = [];
      
      for (let y = 0; y < frame.length; y++) {
        const row = frame[y];
        let newRow = '';
        const relY = y - startPlume;
        
        for (let x = 0; x < row.length; x++) {
          const c = row[x];
          
          // Include plume pixels (they're part of the helmet decoration)
          if (c === PLUME_CHAR && relY <= PLUME_MAX_REL_Y) {
            newRow += c;
          }
          // Include helmet region pixels (body-colored chars inside the mask)
          else if (isInHelmetRegion(x, relY) && HELMET_CHARS.has(c)) {
            newRow += c;
          }
          // Include outline chars inside the helmet region
          else if (isInHelmetRegion(x, relY) && c === '1') {
            newRow += c;
          }
          // Everything else is transparent
          else {
            newRow += '.';
          }
        }
        newFrame.push(newRow);
      }
      newFrames.push(newFrame);
    }
    
    result[animName] = {
      fps: animData.fps,
      frames: newFrames,
      ...(animData.loop !== undefined ? { loop: animData.loop } : {})
    };
  }
  
  return result;
}

// Generate armor sprite frames  
function extractArmorFrames(anims: any): any {
  const result: any = {};
  
  for (const [animName, animData] of Object.entries(anims) as [string, any][]) {
    const newFrames: string[][] = [];
    
    for (const frame of animData.frames) {
      const startPlume = findPlumeStart(frame);
      const newFrame: string[] = [];
      
      for (let y = 0; y < frame.length; y++) {
        const row = frame[y];
        let newRow = '';
        const relY = y - startPlume;
        
        for (let x = 0; x < row.length; x++) {
          const c = row[x];
          
          // Exclude plume (it's helmet decoration, not body armor)
          if (c === PLUME_CHAR && relY <= PLUME_MAX_REL_Y) {
            newRow += '.';
            continue;
          }
          
          // Exclude pixels inside the helmet region
          if (isInHelmetRegion(x, relY)) {
            newRow += '.';
            continue;
          }
          
          // Include body armor chars outside the helmet region
          if (BODY_ARMOR_CHARS.has(c)) {
            newRow += c;
          }
          // Everything else (skin '4', outline '1', transparent '.') is transparent
          else {
            newRow += '.';
          }
        }
        newFrame.push(newRow);
      }
      newFrames.push(newFrame);
    }
    
    result[animName] = {
      fps: animData.fps,
      frames: newFrames,
      ...(animData.loop !== undefined ? { loop: animData.loop } : {})
    };
  }
  
  return result;
}

// Ensure output directory exists
fs.mkdirSync(EQUIP_DIR, { recursive: true });

// Generate iron-helmet.json
const helmetAnims = extractHelmetFrames(knightJson.anims);
const helmetSpriteJson = {
  hd: true,
  palette: {
    "0": "#6bcaea",
    "1": "#131014",
    "2": "#bcd1ce",
    "3": "#bf5749",
    "5": "#3f7299"
  },
  anims: helmetAnims
};
fs.writeFileSync(
  path.join(EQUIP_DIR, 'iron-helmet.json'),
  JSON.stringify(helmetSpriteJson, null, 2) + '\n'
);
console.log('Generated iron-helmet.json');

// Generate steel-armor.json
const armorAnims = extractArmorFrames(knightJson.anims);
const armorSpriteJson = {
  hd: true,
  palette: {
    "0": "#6bcaea",
    "2": "#bcd1ce",
    "5": "#3f7299"
  },
  anims: armorAnims
};
fs.writeFileSync(
  path.join(EQUIP_DIR, 'steel-armor.json'),
  JSON.stringify(armorSpriteJson, null, 2) + '\n'
);
console.log('Generated steel-armor.json');

// Print a sample frame for verification
console.log('\n=== Iron Helmet idle frame 0 (first 35 rows) ===');
helmetAnims.idle.frames[0].slice(0, 35).forEach((row: string, i: number) => {
  if (row.replace(/\./g, '').length > 0) {
    console.log(`${String(i).padStart(2)}: ${row}`);
  }
});

console.log('\n=== Steel Armor idle frame 0 (first 35 rows) ===');
armorAnims.idle.frames[0].slice(0, 35).forEach((row: string, i: number) => {
  if (row.replace(/\./g, '').length > 0) {
    console.log(`${String(i).padStart(2)}: ${row}`);
  }
});

console.log('\nDone! Equipment sprites generated in:', EQUIP_DIR);
