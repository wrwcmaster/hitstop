import * as fs from 'fs';
import * as path from 'path';

// Load knight.json
const data = JSON.parse(fs.readFileSync(path.resolve('src/game/content/sprites/knight.json'), 'utf8'));

// The precise boundary of the helmet dome, front visor, and back cowl.
const helmetMask: Record<number, [number, number]> = {
  7: [16, 25],
  8: [16, 25],
  9: [14, 27],
  10: [12, 25],
  11: [12, 25],
  12: [11, 23],
  13: [10, 25],
  14: [10, 25],
  15: [9, 21],
  16: [9, 15],
  17: [9, 15],
  18: [9, 13],
  19: [9, 12],
  20: [9, 11],
  21: [9, 11],
  22: [9, 11],
  23: [9, 12],
  24: [9, 15],
  25: [10, 15],
  26: [10, 15],
  27: [10, 15],
  28: [11, 15],
  29: [13, 16],
  30: [13, 16]
};

const frame = data.anims.idle.frames[0];
let startPlume = 0;
for (let y = 0; y < frame.length; y++) {
  if (frame[y].includes('3')) {
    startPlume = y;
    break;
  }
}

for (let y = 0; y < frame.length; y++) {
  let row = frame[y];
  let newRow = '';
  const relY = y - startPlume;
  
  for (let x = 0; x < row.length; x++) {
    let c = row[x];
    if (c === '3' && relY <= 18) {
      c = 'p';
    } else if ((c === '0' || c === '2' || c === '5') && helmetMask[relY]) {
      const [minX, maxX] = helmetMask[relY];
      if (x >= minX && x <= maxX) {
        c = c === '0' ? 'h' : (c === '2' ? 'v' : 'h'); // Treat '5' as helmet base too
      }
    }
    
    // Highlight the face with 'F' and body with 'B'
    if (c === '4' && relY >= 20 && relY <= 30) {
       c = 'F'; // Face
    } else if (c === '0' || c === '2') {
       c = 'B'; // Body
    } else if (c === '5') {
       c = 'b'; // Shadow body
    }

    newRow += c;
  }
  
  if (relY >= 5 && relY <= 35) {
     console.log(relY.toString().padStart(2, '0') + ': ' + newRow);
  }
}
