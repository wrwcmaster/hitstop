// The gatehouse as a keep: 90x68 (720x544), a ten-storey tower with the
// Gate Warden holding its roof, a rampart out its flank, and the gate
// fort at the far end. Generated because hand-editing 68 rows of
// masonry is how you lose a legend character and phantom every spike.
import fs from 'node:fs';
const W = 90, H = 68;
const rows = Array.from({ length: H }, () => Array(W).fill('.'));
const put = (r, c0, c1, ch) => { for (let c = c0; c <= c1; c++) rows[r][c] = ch; };
const box = (r0, r1, c0, c1, ch) => { for (let r = r0; r <= r1; r++) put(r, c0, c1, ch); };

// ---- ground ----
put(63, 1, W - 2, '#'); box(64, H - 1, 0, W - 1, '=');
box(54, 63, 0, 0, '=');                       // west wall by the kingsroad door

// ================= THE TOWER (cols 16-40), ten storeys =================
box(20, 58, 16, 17, 'W');                     // west wall
put(59, 16, 17, 'A'); box(60, 62, 16, 17, 'B');          // sally port W
box(21, 39, 39, 40, 'W');                     // east wall above the rampart door
box(44, 58, 39, 40, 'W');                     // east wall below it
put(59, 39, 40, 'A'); box(60, 62, 39, 40, 'B');          // sally port E
box(21, 62, 18, 38, 'B');                     // the shaft itself
// Ten jump-through landings, alternating sides. They overlap by five
// tiles (cols 24-28), not one: a 24px sweet spot ten storeys running,
// with four bats shoving you, is a climber bouncing between the same
// two floors forever. Wide overlap climbs; the open half of each floor
// still lets a falling body ricochet down the zigzag.
const LANDINGS = [[59, 18, 28], [55, 24, 34], [51, 18, 28], [47, 24, 34], [43, 24, 38],   // the rampart storey: open at its west end so the shaft still falls through
                  [39, 24, 34], [35, 18, 28], [31, 24, 34], [27, 18, 28], [24, 18, 23]];
for (const [r, c0, c1] of LANDINGS) put(r, c0, c1, 'L');
// The last landing sits UNDER the hatch, and nothing sits between it
// and the crown. Two ledges three rows apart cannot both hold an 18px
// body, and a step tucked under the crown is a cell you can climb into
// and never leave - the roof has to be one clean 32px hop, the same
// hop every other storey asks for.
put(20, 16, 40, 'K'); put(20, 18, 23, '.');   // crown, hatch at the FAR WEST end
box(17, 19, 16, 17, 'W'); box(17, 19, 39, 40, 'W');      // parapets
put(16, 16, 17, 'C'); put(16, 39, 40, 'C');
// Watch alcoves: a solid floor off the east wall with a lip that pens
// the guard in. The climbing column (cols 24-28) and the descent side
// (cols 18-23) both run clear of them.
for (const r of [45, 33]) { put(r, 34, 38, 'K'); rows[r - 1][33] = 'F'; rows[r - 2][33] = 'F'; }
rows[57][22] = 'S'; rows[45][30] = 'S'; rows[33][22] = 'S'; rows[25][30] = 'S';   // stairwell torches

// ================= THE RAMPART, out the tower's east flank ==============
put(43, 39, 52, 'K'); put(44, 39, 52, 'W');
// Iron bars pen the sentry to his stretch of wall-walk - without them
// he strolls west through the tower door and falls down the shaft.
// Bars rather than merlons because a shot passes through them: he can
// work his bow from behind them, and you can answer with a fireball,
// which stone would have made impossible in both directions. Still a
// hop for anyone crossing.
for (const c of [44, 49]) { rows[41][c] = 'F'; rows[42][c] = 'F'; }
put(46, 54, 56, 'L'); put(49, 57, 59, 'L');   // corbels stepping down to the fort roof

// ================= THE YARD: a watch post =================
// The watch post stands ON the road, not across it: solid to the eye,
// open underneath. Walled to the ground it was a dam - every recorder
// seed ground to a halt at its foot and was shot to death by the
// archer standing on top of it.
put(59, 52, 53, 'K'); box(60, 62, 52, 53, 'B');

// ================= THE GATE FORT (cols 60-89) =================
put(51, 60, 89, 'C'); put(52, 60, 89, 'W');
put(51, 64, 66, '.'); put(52, 64, 66, '.');   // roof hatch
box(53, 56, 62, 88, 'B');                     // the garret
put(53, 71, 74, 'V');                         // hanging teeth: walk under, never jump
rows[55][80] = 'S';
put(57, 62, 85, 'K'); put(58, 62, 85, 'A');   // garret floor = the vault's crown
box(57, 58, 86, 88, '.');                     // drop shaft -> gate alcove
box(59, 62, 62, 88, 'B');                     // the vaulted passage
rows[60][67] = 'S'; rows[60][80] = 'S';
box(53, 59, 60, 61, 'W');                     // west face
put(59, 60, 61, 'A'); box(60, 62, 60, 61, '.');          // ground doorway
box(51, 58, 89, 89, 'W');
box(59, 62, 89, 89, 'D');                     // the keyed gate

const gh = {
  name: 'gatehouse', tileSize: 8,
  legend: { '#': 'rockTop', '=': 'rock', 'D': 'gate', 'W': 'wallStone', 'K': 'wallWalk', 'C': 'wallCap', 'L': 'wallLedge', 'B': 'wallBack', 'A': 'archStone', 'S': 'sconce', 'V': 'spikesDown', 'F': 'grille' },
  tiles: rows.map((r) => r.join('')),
  playerSpawn: { x: 48, y: 480 },
  entities: [
    // the approach
    { type: 'slime', x: 96, y: 486 }, { type: 'slime', x: 136, y: 486 },
    // THE TOWER WATCH, in walled alcoves off the east side of the
    // shaft. Guards posted on the open landings do not stay: nothing in
    // this game looks before it steps, so every one of them patrolled
    // off its ledge and was on the ground floor within five seconds
    // (the rampart archer walked off into the shaft too). Walled in,
    // they hold their storey and shoot across the well at a climber who
    // is on the far side and cannot answer. They hold MELEE, not bows:
    // a 340px well has no cover anywhere in it, so an archer posted in
    // it covers the climb AND the descent from one spot, and that is a
    // firing range rather than a fight - every seed died on the same
    // tile. A guard you must come to is pressure; one you can never
    // reach is just a tax.
    { type: 'slime', x: 285, y: 336 },      // the lower watch alcove
    { type: 'slime', x: 285, y: 240 },      // the upper watch alcove
    // THE KEEPER, on the roof, with his hoard
    { type: 'gate-brute', x: 285, y: 136 }, { type: 'chest', x: 240, y: 140 },
    // The garrison larder, on the shaft floor - SOLID ground, because a
    // chest falls straight through a one-way landing (the sky island
    // taught this once already). Heal here and the ascent is clean; the
    // warden should be fought by someone who chose to arrive whole.
    { type: 'healing-chest', x: 232, y: 480 },
    // the rampart sentry
    { type: 'archer', x: 372, y: 320 },
    // the yard
    { type: 'slime', x: 300, y: 486 }, { type: 'slime', x: 400, y: 486 },
    { type: 'bat', x: 450, y: 456 }, { type: 'archer', x: 420, y: 448 }, { type: 'healing-chest', x: 470, y: 480 },   // the yard well: the garrison drinks here, and so may you
    // the fort
    { type: 'archer', x: 600, y: 384 },       // battlements
    { type: 'slime', x: 560, y: 438 },        // garret guard
    { type: 'bat', x: 620, y: 480 },          // passage roost
    { type: 'chest', x: 640, y: 440 },        // garrison strongbox
  ],
  props: { music: 'overworld', map: { x: 1, y: 2 } },
  triggers: [
    { x: 6, y: 472, w: 10, h: 32, event: 'door', once: false, props: { room: 'kingsroad' } },
    { x: 712, y: 472, w: 8, h: 32, event: 'door', once: false, props: { room: 'cavern', key: 'gate-key', lockedText: 'THE WARDEN HOLDS THE KEY' } },
  ],
};
fs.writeFileSync(new URL('../src/game/content/rooms/gatehouse.json', import.meta.url), JSON.stringify(gh, null, 1) + '\n');
console.log('gatehouse:', W * 8, 'x', H * 8, '|', LANDINGS.length, 'storeys |', gh.entities.length, 'entities');
