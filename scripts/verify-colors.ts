import * as fs from 'fs';
import * as path from 'path';

// Replicate the exact logic from sprites.ts
const knightJson = JSON.parse(fs.readFileSync(path.resolve('src/game/content/sprites/knight.json'), 'utf8'));

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
                break;
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

const PAL = {
  '.': null,
  "0": "#86594c", "2": "#c69e8b", "3": "#5a535b", "5": "#323c39", // body (brown)
  "h": "#6bcaea", "v": "#bcd1ce", "p": "#bf5749", "s": "#3f7299" // helmet (steel)
};

const frame = patched.anims.idle.frames[0];
for (let y = 7; y <= 30; y++) {
  let output = '';
  for (let x = 0; x < frame[y].length; x++) {
    const c = frame[y][x];
    if (c === 'h' || c === 'v' || c === 's' || c === 'p') {
      output += 'H'; // Helmet (Steel)
    } else if (c === '0' || c === '2' || c === '5') {
      output += 'B'; // Body (Brown)
    } else if (c === '4') {
      output += 'S'; // Skin
    } else if (c === '1') {
      output += 'O'; // Outline
    } else {
      output += ' '; // Empty
    }
  }
  console.log(y.toString().padStart(2, '0') + ': ' + output);
}
