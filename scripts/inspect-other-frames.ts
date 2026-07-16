import * as fs from 'fs';
import * as path from 'path';

const SPRITES_DIR = path.resolve('src/game/content/sprites');
const knight = JSON.parse(fs.readFileSync(path.join(SPRITES_DIR, 'knight.json'), 'utf8'));

for (const [animName, animData] of Object.entries(knight.anims) as [string, any][]) {
  console.log(`\n=== Animation: ${animName} ===`);
  animData.frames.forEach((frame: string[], fIdx: number) => {
    console.log(`--- Frame ${fIdx} ---`);
    let startPlume = 0;
    for (let y = 0; y < frame.length; y++) {
      if (frame[y].includes('3')) {
        startPlume = y;
        break;
      }
    }
    
    // Dump relY 20 to 30
    for (let relY = 20; relY <= 30; relY++) {
      const absY = startPlume + relY;
      if (absY < frame.length) {
        console.log(`relY ${String(relY).padStart(2)} (abs ${String(absY).padStart(2)}): ${frame[absY]}`);
      }
    }
  });
}
