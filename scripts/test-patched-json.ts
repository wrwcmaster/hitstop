import * as fs from 'fs';
import * as path from 'path';

// Replicate the exact logic from sprites.ts
const knightJson = JSON.parse(fs.readFileSync(path.resolve('src/game/content/sprites/knight.json'), 'utf8'));

function patchKnightJson(json: any) {
  const copy = JSON.parse(JSON.stringify(json));

  for (const anim of Object.values(copy.anims)) {
    for (const frame of (anim as any).frames) {
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
        10: [[12, 25]],
        11: [[12, 25]],
        12: [[11, 23]],
        13: [[10, 25]],
        14: [[10, 25]],
        15: [[9, 21]],
        16: [[9, 15]],
        17: [[9, 15]],
        18: [[9, 13]],
        19: [[9, 12], [14, 16]],
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
          if (c === '3' && relY <= 18) {
            c = 'p';
          } 
          else if ((c === '0' || c === '2' || c === '5') && helmetMask[relY]) {
            const ranges = helmetMask[relY];
            for (const [minX, maxX] of ranges) {
              if (x >= minX && x <= maxX) {
                if (c === '0') c = 'h';
                else if (c === '2') c = 'v';
                else if (c === '5') c = 's';
                break; // VERY IMPORTANT
              }
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

const patched = patchKnightJson(knightJson);
const idleFrame0 = patched.anims.idle.frames[0];
for (let y = 5; y < 35; y++) {
  console.log(y.toString().padStart(2, '0') + ': ' + idleFrame0[y]);
}
