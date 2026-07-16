import * as fs from 'fs';
import * as path from 'path';

const SPRITES_DIR = path.resolve('src/game/content/sprites');

const knight = JSON.parse(fs.readFileSync(path.join(SPRITES_DIR, 'knight.json'), 'utf8'));
const helmet = JSON.parse(fs.readFileSync(path.join(SPRITES_DIR, 'equipment/iron-helmet.json'), 'utf8'));
const armor = JSON.parse(fs.readFileSync(path.join(SPRITES_DIR, 'equipment/steel-armor.json'), 'utf8'));

const kIdle = knight.anims.idle.frames[0];
const hIdle = helmet.anims.idle.frames[0];
const aIdle = armor.anims.idle.frames[0];

console.log('=== ANALYSIS OF IDLE FRAME 0 ===');
for (let y = 0; y < kIdle.length; y++) {
  const kRow = kIdle[y];
  const hRow = hIdle[y];
  const aRow = aIdle[y];
  
  let line = '';
  for (let x = 0; x < kRow.length; x++) {
    const kc = kRow[x];
    const hc = hRow[x];
    const ac = aRow[x];
    
    if (hc !== '.') {
      line += 'H'; // Helmet
    } else if (ac !== '.') {
      line += 'A'; // Armor
    } else if (kc !== '.') {
      line += 'B'; // Base body / other (skin, outline, weapon etc.)
    } else {
      line += '.';
    }
  }
  console.log(`${String(y).padStart(2)}: ${line}`);
}
