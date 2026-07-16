/**
 * Diagnostic: dump the first idle frame of knight.json BEFORE and AFTER
 * the patchKnightJson transform so we can see exactly which characters
 * got remapped and whether the helmetMask boundaries are correct.
 */
import knightJson from '../src/game/content/sprites/knight.json';

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

const original = knightJson.anims.idle.frames[0];
const patched = patchKnightJson(knightJson).anims.idle.frames[0];

console.log('=== ORIGINAL idle frame 0 ===');
original.forEach((row: string, y: number) => {
  console.log(`${String(y).padStart(2)}: ${row}`);
});

console.log('\n=== PATCHED idle frame 0 ===');
patched.forEach((row: string, y: number) => {
  console.log(`${String(y).padStart(2)}: ${row}`);
});

console.log('\n=== DIFF (changed chars marked with ^) ===');
for (let y = 0; y < original.length; y++) {
  const orig = original[y];
  const patch = patched[y];
  let diff = '';
  let hasDiff = false;
  for (let x = 0; x < Math.max(orig.length, patch.length); x++) {
    if (orig[x] !== patch[x]) {
      diff += '^';
      hasDiff = true;
    } else {
      diff += ' ';
    }
  }
  if (hasDiff) {
    console.log(`${String(y).padStart(2)}: ${orig}`);
    console.log(`    ${patch}`);
    console.log(`    ${diff}`);
  }
}
