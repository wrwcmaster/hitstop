import * as fs from 'fs';
import * as path from 'path';

const SPRITES_DIR = path.resolve('src/game/content/sprites');
const knightPath = path.join(SPRITES_DIR, 'knight.json');

const knight = JSON.parse(fs.readFileSync(knightPath, 'utf8'));

// Revert the eye rows in all frames to use the correct original 55 alignment
for (const [animName, animData] of Object.entries(knight.anims) as [string, any][]) {
  animData.frames.forEach((frame: string[], fIdx: number) => {
    for (let y = 0; y < frame.length; y++) {
      let row = frame[y];
      if (row.includes('4422255522222252..')) {
        frame[y] = row.replace('4422255522222252..', '4422255222222521..');
      } else if (row.includes('4422255522222052..')) {
        frame[y] = row.replace('4422255522222052..', '4422255222220521..');
      }
    }
  });
}

fs.writeFileSync(knightPath, JSON.stringify(knight, null, 2) + '\n');
console.log('Successfully reverted eye/visor row coordinates to fix the right eye alignment in all frames');
