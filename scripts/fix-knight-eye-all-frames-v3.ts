import * as fs from 'fs';
import * as path from 'path';

const SPRITES_DIR = path.resolve('src/game/content/sprites');
const knightPath = path.join(SPRITES_DIR, 'knight.json');

const knight = JSON.parse(fs.readFileSync(knightPath, 'utf8'));

// Apply the user's new eye/cheek shadow layout to all frames of knight.json
for (const [animName, animData] of Object.entries(knight.anims) as [string, any][]) {
  animData.frames.forEach((frame: string[], fIdx: number) => {
    for (let y = 0; y < frame.length; y++) {
      let row = frame[y];
      if (row.includes('4422255222222521..')) {
        frame[y] = row.replace('4422255222222521..', '4422255222225521..');
      } else if (row.includes('4422255222220521..')) {
        frame[y] = row.replace('4422255222220521..', '4422255222225521..');
      }
    }
  });
}

fs.writeFileSync(knightPath, JSON.stringify(knight, null, 2) + '\n');
console.log('Successfully updated the cheek shadow in all frames of knight.json');
