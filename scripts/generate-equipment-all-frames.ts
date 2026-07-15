import * as fs from 'fs';
import * as path from 'path';

const SPRITES_DIR = path.resolve('src/game/content/sprites');
const EQUIP_DIR = path.join(SPRITES_DIR, 'equipment');

// Load user's modified files
const knight = JSON.parse(fs.readFileSync(path.join(SPRITES_DIR, 'knight.json'), 'utf8'));
const helmet = JSON.parse(fs.readFileSync(path.join(EQUIP_DIR, 'iron-helmet.json'), 'utf8'));
const armor = JSON.parse(fs.readFileSync(path.join(EQUIP_DIR, 'steel-armor.json'), 'utf8'));

// Extract idle frame 0
const kIdle = knight.anims.idle.frames[0];
const hIdle = helmet.anims.idle.frames[0];
const aIdle = armor.anims.idle.frames[0];

// Find plume start in knight idle
let kStartPlume = 0;
for (let y = 0; y < kIdle.length; y++) {
  if (kIdle[y].includes('3')) {
    kStartPlume = y;
    break;
  }
}

// Build pixel masks relative to startPlume
const helmetMask: Record<number, boolean[]> = {};
const armorMask: Record<number, boolean[]> = {};

for (let y = 0; y < kIdle.length; y++) {
  const relY = y - kStartPlume;
  const hRow = hIdle[y];
  const aRow = aIdle[y];
  
  helmetMask[relY] = Array(35).fill(false);
  armorMask[relY] = Array(35).fill(false);
  
  for (let x = 0; x < 35; x++) {
    if (hRow && hRow[x] && hRow[x] !== '.') {
      helmetMask[relY][x] = true;
    }
    if (aRow && aRow[x] && aRow[x] !== '.') {
      armorMask[relY][x] = true;
    }
  }
}

// Helper to find plume start in any frame
function findPlumeStart(frame: string[]): number {
  for (let y = 0; y < frame.length; y++) {
    if (frame[y].includes('3')) return y;
  }
  return 0;
}

// Generate all frames using the learned masks
function generateEquipmentFrames(mask: Record<number, boolean[]>): Record<string, any> {
  const result: Record<string, any> = {};
  
  for (const [animName, animData] of Object.entries(knight.anims) as [string, any][]) {
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
          const isKept = mask[relY] && mask[relY][x];
          
          if (isKept) {
            newRow += c;
          } else {
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

// Generate and write iron-helmet.json
const generatedHelmetAnims = generateEquipmentFrames(helmetMask);
helmet.anims = generatedHelmetAnims;
fs.writeFileSync(
  path.join(EQUIP_DIR, 'iron-helmet.json'),
  JSON.stringify(helmet, null, 2) + '\n'
);
console.log('Successfully generated and updated all frames of iron-helmet.json');

// Generate and write steel-armor.json
const generatedArmorAnims = generateEquipmentFrames(armorMask);
armor.anims = generatedArmorAnims;
fs.writeFileSync(
  path.join(EQUIP_DIR, 'steel-armor.json'),
  JSON.stringify(armor, null, 2) + '\n'
);
console.log('Successfully generated and updated all frames of steel-armor.json');
