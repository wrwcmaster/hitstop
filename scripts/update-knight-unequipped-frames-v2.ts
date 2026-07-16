import * as fs from 'fs';
import * as path from 'path';

const SPRITES_DIR = path.resolve('src/game/content/sprites');
const knightPath = path.join(SPRITES_DIR, 'knight.json');

const knight = JSON.parse(fs.readFileSync(knightPath, 'utf8'));

// Extract rows 0 to 53 of the user's redesigned unequipped idle frame 0
const newBodyRows = knight.anims.idle.frames[0].slice(0, 54);

// Update other frames based on their startPlume/head shifts:
// - idle: already updated by the user (shift 0)
// - run[0]: shift +1
// - run[1]: shift 0
// - run[2]: shift +1
// - run[3]: shift 0
// - air[0]: shift +1
const shifts: Record<string, number[]> = {
  idle: [0],
  run: [1, 0, 1, 0],
  air: [1]
};

for (const [animName, animData] of Object.entries(knight.anims) as [string, any][]) {
  const animShifts = shifts[animName];
  if (!animShifts) continue;
  
  animData.frames.forEach((frame: string[], fIdx: number) => {
    // Skip idle frame 0 as it is our template source
    if (animName === 'idle' && fIdx === 0) return;
    
    const shift = animShifts[fIdx] ?? 0;
    
    if (shift === 0) {
      // Replace rows 0 to 53
      for (let y = 0; y <= 53; y++) {
        frame[y] = newBodyRows[y];
      }
    } else if (shift === 1) {
      // Set row 0 to transparent
      frame[0] = '.'.repeat(35);
      // Replace rows 1 to 54 with body rows 0 to 53
      for (let y = 0; y <= 53; y++) {
        frame[y + 1] = newBodyRows[y];
      }
    }
  });
}

fs.writeFileSync(knightPath, JSON.stringify(knight, null, 2) + '\n');
console.log('Successfully updated upper body (rows 0-53) in all other frames of knight.json!');
