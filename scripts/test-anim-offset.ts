import * as fs from 'fs';
import * as path from 'path';

const data = JSON.parse(fs.readFileSync(path.resolve('src/game/content/sprites/knight.json'), 'utf8'));

for (const [animName, anim] of Object.entries(data.anims)) {
  for (let i = 0; i < (anim as any).frames.length; i++) {
    const frame = (anim as any).frames[i];
    let plumeX = -1;
    let plumeY = -1;
    for (let y = 0; y < frame.length; y++) {
      const idx = frame[y].indexOf('3');
      if (idx !== -1) {
        plumeY = y;
        plumeX = idx;
        break;
      }
    }
    console.log(`${animName} frame ${i}: plume at X=${plumeX}, Y=${plumeY}`);
  }
}
