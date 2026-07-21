import { writeFileSync } from 'node:fs';
const TS = 8, MW = 44, MH = 68, WIDTH = 8, STEP = 7, RISE = 4;
const m = Array.from({ length: MH }, (_, y) =>
  (y >= MH - 2 ? '='.repeat(MW) : y === MH - 3 ? '#'.repeat(MW) : '=' + '.'.repeat(MW - 2) + '='));
// Switchback staircase: each ledge steps STEP across and RISE up, turning
// back at the walls. STEP < WIDTH so consecutive ledges overlap — every
// hop is a short one, which is the whole difference between a climb and
// a wall.
let x = 2, dir = 1;
const ledges = [];
for (let row = MH - 7; row > 4; row -= RISE) {
  m[row] = m[row].slice(0, x) + '-'.repeat(WIDTH) + m[row].slice(x + WIDTH);
  ledges.push({ row, x0: x, x1: x + WIDTH - 1 });
  const next = x + dir * STEP;
  if (next < 2 || next + WIDTH > MW - 2) dir = -dir; else x = next;
}
const top = ledges[ledges.length - 1];
// Run the summit ledge all the way to its wall, so arriving from the
// ramparts lands ON it instead of in thin air beside it.
const eastSummit = top.x0 > 4;
if (eastSummit) { m[top.row] = m[top.row].slice(0, top.x0) + '-'.repeat(MW - 2 - top.x0) + m[top.row].slice(MW - 2); top.x1 = MW - 3; }
else { m[top.row] = m[top.row].slice(0, 1) + '-'.repeat(top.x1) + m[top.row].slice(top.x1 + 1); top.x0 = 1; }
const mountain = {
  name: 'mountain', tileSize: TS, legend: { '#': 'rockTop', '=': 'rock', '-': 'platform', 'D': 'gate' },
  tiles: m,
  playerSpawn: { x: 3 * TS, y: (MH - 4) * TS - 18 },
  entities: [],
  triggers: [
    { x: TS, y: (MH - 7) * TS, w: TS, h: 4 * TS, event: 'door', once: false, props: { room: 'town' } },
    // Summit door, on whichever wall the top ledge finishes against.
    { x: eastSummit ? (MW - 2) * TS : TS, y: (top.row - 4) * TS, w: TS, h: 4 * TS,
      event: 'door', once: false, props: { room: 'ramparts' } },
  ],
  props: { map: { x: 16, y: 0 } },
};
writeFileSync('./src/game/content/rooms/mountain.json', JSON.stringify(mountain, null, 2) + '\n');
let worst = 0;
for (let i = ledges.length - 1; i > 0; i--) {
  const a = ledges[i], b = ledges[i - 1];
  const gap = b.x0 > a.x1 ? b.x0 - a.x1 : a.x0 > b.x1 ? a.x0 - b.x1 : 0;
  worst = Math.max(worst, gap);
}
console.log('ledges:', ledges.length, ' rise per hop:', RISE * TS + 'px', ' worst horizontal gap:', worst * TS + 'px');
console.log('top ledge row', top.row, 'cols', top.x0 + '-' + top.x1, ' summit door on', eastSummit ? 'east' : 'west', 'wall');
