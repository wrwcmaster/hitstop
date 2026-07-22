# Adding content: a cookbook

Everything here follows the same pattern: **register a definition, and the engine + tools pick it up.** No engine edits, no editor edits.

## The damage scale

Health and mana are **point pools**, not icon counts: the knight starts at **100 HP / 60 MP** (before class and skill-tree bonuses), and the HUD draws them as bars. So pick damage numbers on that scale and they'll read distinctly — the bar visibly takes a different bite for each.

Roughly how the built-in bestiary is spread, as a calibration reference:

| Band | Damage | Examples |
| --- | --- | --- |
| Chip | 8–12 | bat contact, devourer digest tick |
| Light | 14–18 | slime contact, pike, archer arrow, duelist saber |
| Heavy | 22–28 | gunner bullet, brute contact, duelist pistol |
| Signature | 30 | Slime King's slam, the Duelist's blur |

Player-side, a plain sword swing is ~20 and a `nova` ~60 against monsters in the 40–240 range (bosses 600–900). Nothing is restricted to whole numbers — `damage: 0.5` works fine and the floater/readout format it with one decimal (`formatAmount`) — but with pools this size you rarely need fractions.

## Armor that soaks (and wears out)

Armor is a **flat soak**, not extra health: give an equipment item an `armor` stat and a `durability` prop.

```ts
defineItem<ItemCtx>('iron-helmet', {
  name: 'IRON HELMET', desc: 'Soaks 4 damage a blow. Dents until it splits.',
  icon: MY_ICON, kind: 'equipment', slot: 'helmet',
  mods: { add: { armor: 4 } },     // subtracted from each incoming blow
  props: { durability: 200 },      // total soaking before it breaks for good
});
```

Two rules keep this from trivialising combat, both in `Player.mitigate`:

1. **A soak is capped at half of the incoming blow** (`ARMOR_MAX_SOAK`). Flat reduction alone would make a well-armored knight *immune* to chip damage and would flatten the damage spread — with the cap, a bat's 10 still stings and a boss's 30 still hurts more than an archer's 18.
2. **Soaking consumes durability**, split across the pieces in proportion to what each absorbed. At zero the piece is destroyed — unequipped *and* removed from the bag. Armor is a resource you spend, not a permanent upgrade.

Measured with the shipped values (helmet 4 + plate 8, on a 120 HP knight): survivability goes ×2.00 against chip damage but only ×1.75 against a boss slam, and the full set lasts ~67 soaked blows. That's deliberately close to the old "+100 max HP" armor it replaced — comparable power, but now shaped (better against small hits) and temporary.

Any actor can mitigate: the engine hook is `Actor.mitigate(damage, opts)` (default: unchanged), so monster armor or elemental resistances are the same mechanism.

## A new enemy (~20 lines)

Create the definition (in `src/game/actors/enemies.ts`, or a new file you import from `main.ts`):

```ts
defineMonster('spitter', {
  hp: 80, damage: 16, w: 14, h: 10, score: 250,
  colors: [COLORS.gold, COLORS.redDark, COLORS.white],   // gibs, telegraphs, editor chip
  init(m) {
    m.state.cooldown = 1.5;
  },
  update(m, dt) {
    m.vx *= Math.pow(0.01, dt);                          // friction
    m.state.cooldown = (m.state.cooldown as number) - dt;
    const player = m.player;
    if (player && (m.state.cooldown as number) <= 0) {
      m.facing = player.cx > m.cx ? 1 : -1;
      m.vx = -m.facing * 60;                             // recoil
      m.state.cooldown = 2 + Math.random();
      // fire a projectile, spawn a shockwave, etc.
    }
  },
  draw(g, m) {
    g.drawImage(m.img(MY_SPRITE), Math.round(m.x), Math.round(m.y));  // m.img = auto hit-flash
  },
});
```

What you get for free: gravity + collision, health, knockback scaled by `mass`, hit-flash, death gibs + kill feedback, spawn telegraphs, scoring (via the `kill` event), and a palette entry in the level editor.

Conventions:
- `m.state` is your scratch space (typed `Record<string, number | boolean>`).
- `m.player` finds the player for targeting (may be `undefined` — dead).
- `flies: true` skips gravity; `mass > 1` resists knockback.
- Behavior beyond a few ifs? Use the engine `FSM` inside `init`.

## New pixel art

Two options:

1. **Sprite editor** (`/tools/sprite-editor.html`): paint, animate, export — then paste rows into a `sprite([...], PAL)` call in `src/game/content/sprites.ts`. Full walkthrough in [design-tools.md](design-tools.md).
2. **By hand**: sprites are text; the palette chars are defined in `src/game/content/palette.ts`.

```ts
const ORB = sprite([
  '.YY.',
  'YWWY',
  'YWWY',
  '.YY.',
], PAL);
```

For animation, group frames with `withFacing({ fly: { frames: [ORB, ORB2], fps: 8 } })` and pick frames with `frameAt(set, 'fly', actor.animT)`.

## A new tile type

In `src/game/content/tiles.ts`:

```ts
tiles.register('spikes', {
  solid: false,          // or solid / oneWay
  hazard: 20,            // damage on touch, on the 100-HP scale (see the real spikes)
  draw(g, px, py, size) {
    g.fillStyle = COLORS.steel;
    for (let i = 0; i < size; i += 4) {
      g.beginPath();
      g.moveTo(px + i, py + size); g.lineTo(px + i + 2, py + size - 5); g.lineTo(px + i + 4, py + size);
      g.fill();
    }
  },
});
```

It immediately appears in the level editor's tile palette. A `hazard`
tile hurts on touch: the tilemap answers `hazardAt(rect)` (the strongest
hazard the rect overlaps) and the player reacts after her move — damage,
i-frames, and an upward launch. `water: true` marks a tile swimmable
(see the grotto).

## A new room / level

Use the level editor (`/tools/level-editor.html`): paint tiles, place monsters, set the player spawn, then **test play** (one click, uses `?room=local`) and iterate. When happy, **download** the JSON into `src/game/content/rooms/` and load it in `main.ts`.

Or edit the JSON directly — it's designed to be hand-editable:

```json
{
  "name": "cave-1",
  "tileSize": 8,
  "legend": { "#": "rockTop", "=": "rock", "-": "platform" },
  "tiles": ["....", "•120-char rows•", "####"],
  "playerSpawn": { "x": 230, "y": 192 },
  "entities": [{ "type": "slime", "x": 300, "y": 200 }]
}
```

## A new sound

In `src/game/content/sfx.ts` — compose the two synth primitives:

```ts
sfx.define('fireball', (s) => {
  s.hiss(0.12, 0.15);                       // whoosh
  s.tone(500, 120, 0.2, 'sawtooth', 0.1);   // falling growl
});
```

Play it from anywhere with `game.feel.sfx.play('fireball')` or pass `sfx: 'fireball'` to `feel.impact`.

## A new item (consumable, equipment, pickup)

In `src/game/content/items.ts` — an item is data + hooks with a typed context:

```ts
defineItem<ItemCtx>('haste-draught', {
  name: 'HASTE DRAUGHT', desc: 'Move like the wind for a while.',
  icon: MY_ICON, kind: 'consumable', stack: 3,
  use({ game, player }) {
    player.stats.setSource('buff:haste', { mult: { speed: 1.5 } });
    game.feel.sfx.play('heal');
    // (a World system or timer should removeSource later)
  },
});
```

Kinds: `consumable` (usable from the inventory menu; return `false` from `use` to abort without consuming), `equipment` (occupies a `slot`, contributes `mods` to stats while worn), `instant` (applies on pickup — coins, mana orbs), `key` (inert, held).

Drop it from monsters by adding to their `drops` table, place it in a room, or grant it in code with `player.inventory.add(id)`. The `Pickup` entity handles the pop-out → magnet → collect flow and the name toast.

## A new weapon

A weapon separates combat data from appearance. First register its visual:

```ts
defineWeaponVisual('dagger', proceduralBlade({
  bladeLen: 5,
  bladeW: 1,
  blade: COLORS.steel,
  hilt: COLORS.gold,
}));
```

Define a weapon type when its swing rhythm is new. Types can be shared by
several items (for example, rusty and iron swords):

```ts
defineWeaponType('dagger', {
  comboWindow: 0.2,
  attacks: [{
    animation: 'attack', frameDirection: 1,
    duration: 0.14, active: [0.12, 0.55],
    damageScale: 1, strength: 0.3, lunge: 55,
    hitbox: { forward: -2, y: 0, w: 16, h: 12 },
    trail: { startAngle: -1.1, endAngle: 1.1, radius: 11, thickness: 2.5 },
    bodyWeight: 0.8, lift: 0, movementKeep: 0.003,
  }],
});

defineWeapon('dagger', {
  type: 'dagger', visual: 'dagger', baseDamage: 20,
  colors: [COLORS.white],
});

defineItem<ItemCtx>('dagger', {
  name: 'DAGGER', desc: 'Fast and mean.',
  icon: weaponIcon('dagger'), kind: 'equipment', slot: 'weapon',
});
```

No player-code changes: combo length, timing, damage windows, range, lunge, feel strength, body motion, slash colors, held art, and attack trail flow from the registries. Stat bonuses (`mods: { add: { attack: 20 } }`) stack on top. `unarmed` is registered through the same path rather than handled as a fallback special case.

### One sprite per move

Every move in a weapon's moveset names its own sheet animation — the combo swings (`attack`, `attack2`, `attack3`) and the contextuals (`aerial`, `plunge`, `upper`, `dash`). **A sheet owes only its base `attack`**: any move whose animation is absent falls back to the normal attack pattern automatically, so per-move art is pure opt-in.

```jsonc
"anims": {
  "attack": { "fps": 18, "frames": [ /* the swing every move can borrow */ ] },
  "plunge": { "fps": 12, "frames": [ /* its own art, whenever it exists */ ] }
  // upper, dash, aerial, attack2, attack3: nothing to declare — they
  // fall back to "attack" until someone draws them
}
```

The rusty sword's plunge is the shipped example: a committed point-down thrust instead of the borrowed swing. Sheets may also **alias** one animation to another explicitly (`"upper": "aerial"` — a string instead of frames, resolved at load with cycle detection) when a move should borrow something *other* than the default. In the sprite editor an alias shows as `upper→aerial` and editing under it edits its target; the composite panel is where per-move art is judged, posed on the full player with the move's own trail — on the base `attack` animation, its move selector still poses every un-arted move.

### Shaping an attack trail

Beyond the four required fields, `trail` takes three optional ones that turn the same renderer into very different swings:

- **`bias`** (0–1, default `0.8`) — where along the arc the band is fattest. `0.5` is symmetric and reads as a crescent moon; higher values pile the mass behind the tip so it reads as a comet chasing the blade.
- **`glow`** (default `0`) — width of a soft halo outside the arc, as a multiple of `thickness`. Worth reserving for heavy moves, so brightness stays a signal that an attack hits hard.
- **`sweep`** (0–1, default: the end of `active`) — how much of the attack the arc takes to draw itself.

`sweep` exists because how fast a blade *looks* like it swept is not how long it can hit, and the plunge proves it: the move stays dangerous for its entire descent but is cut short by landing, so with the arc welded to the damage window a short drop only ever showed a sliver. Giving it `sweep: 0.16` forms the full crescent within a few frames, and it then rides beneath the knight for as long as she is falling. The arc holds at full brightness while the attack can still hit and fades once it is spent, so what is on screen matches what the hitbox is doing.

### Putting a room on the world map

The map screen (M) draws every room that declares a placement — the position of its top-left corner, in grid cells:

```json
"props": { "map": { "x": 11, "y": 2 } }
```

A room that omits `map` never appears, which is how the dev test room stays off a player-facing screen without a special case anywhere.

**Only the position is authored.** How many cells a room covers is derived from its tile dimensions: one cell is one screenful (30x17 tiles), so a four-screen hall draws four cells wide and the map reads as a floor plan rather than a uniform flowchart. Resize the room and the map follows.

The cost of deriving spans is that growing a room can push it into its neighbour, so overlapping placements throw at boot naming both rooms — the same bargain the rest of the content validation makes.

**Connections are not authored.** Rooms already say how they join through their `door` triggers, so `content/worldmap.ts` derives the door marks from those: each connecting door is placed at its true spot on the shared edge (its position within the room, scaled into the room's cell span), and the map draws a pip there rather than a line between region centres. Move a door and the map follows, with no second table to forget. Exploration reuses the `visited:<room>` flags the portal menu already sets, so a room appears on the map exactly when you have stood in it.

### Doors join two rooms, not a room and a coordinate

A `door` trigger names only where it leads:

```json
{ "event": "door", "x": 12, "y": 64, "w": 20, "h": 32, "props": { "room": "cavern" } }
```

Walking through lands you at the destination's own door **back here** (`PlayScene.doorLanding`), so the two triggers are two sides of one doorway. Turning round and walking back returns you to the spot you left, and neither end can drift from the other, because there is only one definition of where the doorway is. Arrival coordinates are not accepted — that was a second definition waiting to disagree with the first.

You arrive *beside* the far doorway, not inside it, so a walk-through door can't throw you straight back where you came from.

A door whose destination has no door home is a one-way drop; that falls back to the room's `playerSpawn`.

### Which doorways you walk through

An open doorway in a room's **outer wall** is a gap you simply walk into — no key press. Everything else waits for interact:

| doorway | behaviour | looks like |
| --- | --- | --- |
| open, in the outer wall | walk through on contact | a gap in the wall |
| open, in the room's interior | press E | a gap in the wall |
| locked (`key` or `flag`) | press E, refused with a banner | a banded timber door |

Outer-wall doorways sit **flush with the room boundary** — the outermost tile column — so you cross only when you have actually walked to the edge of the room. Placed even a couple of tiles inboard, the room swaps out while there is still visible floor ahead of you, which reads as the game snatching control rather than you leaving.

The interior exception matters more than it sounds. The shaft down to the grotto and the stair up to the ramparts sit in the middle of floors you have every reason to walk across; firing those on contact means you can no longer cross your own room without being swallowed. Castlevania solves it the same way — doors live at the edges, and the way down is something you choose.

A trigger action decides this for itself via `TriggerAction.autoFire`, asked fresh every time because the answer changes mid-room: a barred door becomes a walk-through gap the instant you pick up its key.

### Vertical seams: wells and ceiling gaps

A pair of doors can join two rooms **vertically** — the town well over the underground's ceiling gap. Mark the floor side `fallIn` and the ceiling side `leapUp`:

```json
// town: a shaft in the floor
{ "event": "door", "x": 200, "y": 240, "w": 32, "h": 16, "props": { "room": "underground", "fallIn": true } }
// underground: the gap in the ceiling above it
{ "event": "door", "x": 40, "y": 0, "w": 24, "h": 8, "props": { "room": "town", "leapUp": true } }
```

Both fire only on genuine motion through them — falling for `fallIn`, rising for `leapUp` — and the landing rules change: you arrive **in** the far opening rather than beside it, and your velocity carries across the transition. Drop down the well and you emerge under the far ceiling still falling, to land on whatever the room put beneath the gap; jump up through the gap and the same jump lifts you out of the well's mouth. The room swap is a splice in one continuous arc, which is what makes the two rooms read as one place.

The physics stays **honest**: a weak jump gets no boost. A tapped jump can cross the seam and still fail the far mouth — and then it falls back down *inside* the shaft it arrived in, which is a blind spot for entry-edge triggering (there is no entry left to fire). So vertical seams are checked every frame the player overlaps them (`PlayScene.updateVerticalSeams`): the moment the motion matches the door — falling for `fallIn`, rising for `leapUp` — through you go. A failed exit simply returns you to the room below, back on the bar you jumped from; the motion gate itself prevents refiring, since you cannot be both standing and falling.

The corollary is that the seam's difficulty lives in the **room geometry**, not in code: place the bar close enough under the gap, and the far mouth shallow enough, that a full jump clears it with margin. In the shipped well, a held jump crosses with ~50px of rise in hand against a 24px mouth — comfortable; the only jump that bounces back is one deliberately cut short.

Keep a `leapUp` trigger **thin** (the top row of the gap). Anything taller reaches down to where the player stands waiting to jump — and since triggers fire on entry, a trigger you are already inside has spent its edge before the jump begins.

### Sealing a boss in

Give a boss room's doors `"bossSeal": true` and they lock while any boss in the room draws breath, opening the instant he doesn't:

```json
{ "event": "door", "props": { "room": "corridor", "bossSeal": true } }
```

This is the only lock that works backwards — every other one opens once you have *earned* something. It asks the world directly rather than raising a flag, so the seal can't be left set: no cleanup path to forget, and it lifts even if the boss dies to something other than you.

One wrinkle worth knowing, since it applies to any lock that opens mid-room: triggers fire on entry, so a doorway that has already refused you won't fire again while you stand in it. Kill the boss with your shoulder against the door and nothing would happen until you stepped away and back. `PlayScene.rearmUnsealedDoors` watches for a doorway relenting and calls `Triggers.rearm` so it opens under you.

Because only locked doorways carry door art, **seeing a door means it wants something from you** — the art is the lock, not decoration every threshold happens to wear.

The map is always scaled to the full extent of the world rather than to the part discovered so far. A map that re-centres itself as you explore is disorienting — a room you have seen should stay where you remember it, and the blank space around it honestly reads as "there is more out there".

### Pixel art instead of a drawn arc

An attack can play authored frames rather than the procedural crescent. Register the sheet by **shape**, then point an attack at it:

```ts
const crescent = withFacing(load(slashCrescentJson).animSet());
defineSlashVisual('crescent', {
  frames: { right: crescent.right.slash.frames, left: crescent.left.slash.frames },
  origin: { x: 12.5, y: -4 }, // arc pivot inside the sheet, pinned to the hand
});

// ...then on the attack:
trail: { /* ...angles, radius, thickness... */ sweep: 0.16, sprite: 'crescent' },
```

Shape, not weapon, is the right key: a plunge and a dash want different art, while every sword can share one plunge. Mirroring is free (`withFacing` pre-flips, and the pivot flips with it), and frames advance on the same eased clock the procedural arc sweeps on — so `sweep` matters just as much here. A six-frame sheet spread across a plunge that ends on landing would otherwise never get past frame two.

Leaving `sprite` off falls back to the procedural arc, and that fallback is the point: a new weapon looks right before anyone has drawn a single frame for it. Author art for the showpiece moves; let the rest ride the generated crescent.

The committed `slash-crescent.json` was baked from the procedural arc's own geometry (same radius, angles and taper) so it dropped in without re-tuning. It is ordinary sprite rows — hand-edit it frame by frame like any other art here.

For authored art, create a transparent weapon-only JSON sheet with `idle`/`run`/`air` frames aligned to the knight's world origin (optionally add `attack` frames), load it with `loadSprite` + `withFacing`, and register `spriteWeapon({ anims, origin?, anchors? })`. A sheet may be larger than the knight frame so long blades and attack arcs are not clipped. `spriteWeapon` also trims and fits the idle frame into the standard item-icon footprint, so the item can use `weaponIcon(visualId)` instead of duplicating art in `icons.json`. The built-in swords follow this route in `content/sprites/equipment/`; `scripts/generate-weapon-sheets.mjs` is their reproducible source. The sprite editor can refine the sheets, while the origin and anchors provide alignment corrections without adding weapon logic to Player.

## A ranged weapon (bow, gun) or ballistic attack

Give a weapon type a `ranged` block and the attack button shoots instead of swinging:

```ts
defineWeaponType('bow', {
  comboWindow: 0,
  attacks: [], // ranged types may skip melee entirely
  ranged: { projectile: 'arrow', speed: 330, gravity: 420, cooldown: 0.55, recoil: 30 },
});
```

Arrows arc under gravity (hold ↑ to loose at 45°, ↓ mid-air for a steep shot); bullets are fast and nearly flat. Both fire through `content/ballistics.ts` — `shootArrow`/`shootBullet` wrap `game.combat.shoot` with the shared visuals, feel, and a `snapKind` tag that co-op guests use to draw the real silhouette.

**Hold-to-charge**: add a `charge` block and the weapon is *drawn* instead of clicked — holding attack pulls the string (the player enters the `draw` state; dash or parry cancels without loosing), and releasing fires at a power the hold earned. Power multiplies muzzle speed — which under gravity IS the range — plus damage and recoil. The gesture itself is the engine's `Charge` (`engine/input/charge.ts`): `time` seconds to full draw, an instant tap fires at `floor` power, `curve` shapes the ramp:

```ts
ranged: {
  projectile: 'arrow', speed: 330, gravity: 420, cooldown: 0.55, recoil: 30,
  charge: { time: 0.8, floor: 0.4, curve: 1.4 }, // omit = fire on press (the gun)
},
```

Monsters aim with the engine solvers from `math/ballistics.ts`:

```ts
const v = ballisticVelocity(dx, dy, 320, ARROW_GRAVITY) // fixed speed; null if out of range
  ?? ballisticLob(dx, dy, ARROW_GRAVITY, 70);           // mortar-style, always solvable
shootArrow(m.game, m.collision, { x: m.cx, y: m.y + 4, vx: v.vx, vy: v.vy, damage: 18, targets: 'player', attacker: m });
```

See the `archer` (solver-aimed arcing arrows with a draw-back telegraph) and `gunner` (leveled musket, flat crack) in `actors/enemies.ts`.

## A new skill / spell

In `src/game/content/skills.ts`. A skill is cooldown + cost + a cast that usually fires a `Strike` or a projectile — so impact feedback comes free:

```ts
defineSkill<SkillCtx>('ice-shard', {
  name: 'ICE SHARD', desc: 'A piercing cold bolt.',
  cooldown: 0.8, cost: 1,
  cast({ game, player }) {
    game.combat.shoot({
      x: player.cx, y: player.cy, vx: player.facing * 300, vy: -20,
      gravity: 200, pierce: 1,
      strike: { damage: 20, targets: 'enemy', attacker: player, strength: 0.5 },
      draw(g, p) { g.fillStyle = '#a8dadc'; g.fillRect(p.x - 2, p.y - 2, 4, 4); },
    }, player.collision);
  },
});
```

Teach it with `player.skills.learn('ice-shard')` and add an input slot to `DEFAULT_SKILL_LOADOUT` (or cast it from AI). The `SkillBook` handles cooldowns and mana; return `false` from `cast` to abort without charging.

## A conversation

In `src/game/content/conversations.ts` — pure data, with optional branching:

```ts
defineConversation('blacksmith', {
  lines: [
    { speaker: 'SMITH', text: 'THAT SWORD HAS SEEN BETTER DAYS.' },
  ],
  choices: [
    { label: 'REFORGE IT.', then: 'blacksmith-reforge' },
    { label: 'LEAVE.' },
  ],
});
```

Start it from a room trigger (below), or in code:
`scene.openConversation('blacksmith')` / push a `DialogueScene`. React to outcomes via the `onEnd` callback or events.

## A level event (trigger region)

Rooms carry `triggers` — rectangles that fire a named event when the player enters (drawn by dragging in the level editor's trigger mode):

```json
"triggers": [
  { "x": 180, "y": 140, "w": 110, "h": 92, "event": "talk", "once": true,
    "props": { "conversation": "intro" } }
]
```

Two events are built in: `talk` opens the conversation named in `props.conversation`, and `door` transitions to `props.room` (spawning at `props.x/y`, with a fade; use `"once": false` so doors re-fire). Their definitions validate those property bags at room entry. A registered action supplies both `run` and optional `validateProps`; unregistered event names remain available to ad-hoc event-bus listeners.

## A new room in the world

1. Build it in the level editor (or generate the JSON), download into `src/game/content/rooms/`.
2. Register it in `content/rooms/index.ts` (`ROOMS.myroom = validateRoom(myroomJson)`).
3. Connect it: draw `gate` tiles where the doorway should look like one, and drag a `door` trigger over them pointing at the target room (and one pointing back). Spawn points should sit a couple of tiles clear of the return door so you don't ping-pong.

Entering a room spawns its `entities`, arms its `triggers`, starts waves only if `props.waves` is set, and drops a checkpoint save.

## A puzzle (platforms, levers, plates, barriers)

The gizmos in `src/game/actors/gizmos.ts` are ordinary placeables, wired
together in room JSON by **switch flags** — named story flags
(`switch:<id>`) that levers and plates write via the `setFlag` event and
barriers read live. Puzzle state persists in saves for free.

```json
"entities": [
  { "type": "platform", "x": 100, "y": 200,
    "props": { "w": 28, "h": 6, "dx": 60, "dy": 0, "period": 5 } },
  { "type": "lever",   "x": 424, "y": 86,  "props": { "switch": "vault-a" } },
  { "type": "barrier", "x": 480, "y": 176, "props": { "switch": "vault-a", "w": 8, "h": 56 } },
  { "type": "plate",   "x": 566, "y": 190, "props": { "switch": "vault-b" } },
  { "type": "barrier", "x": 728, "y": 176, "props": { "switch": "vault-b", "w": 8, "h": 56, "linger": 3.5 } }
]
```

- **platform** glides a sine path (`dx/dy` offset over `period` seconds,
  eased at both ends; `phase` staggers pairs) and carries whoever stands
  on it. Its `Solid` lives in `Tilemap.extraSolids`, so normal physics
  collides with it.
- **lever** latches: interact (E) toggles its flag either way.
- **plate** holds its flag only while someone stands on it
  (`latch: true` makes the press permanent). In co-op, both knights press
  plates; levers answer the host's interact key only.
- **barrier** is a wall until its flag is set. `linger` keeps it open
  N seconds after the flag drops — pair it with a plate for a timed run.

Spike pits (`spikes` hazard tiles) are the traps between the machinery;
the **vault** (`rooms/vault.json`, behind the heavy door in town) is the
reference puzzle room.

## A boss

A boss is a monster with `boss: true`, a `displayName` (drives the HP bar), and an engine `FSM` in its state. Set `epilogue: '<conversation>'` for the after-kill dialogue (default `'victory'`); felling it sets a per-boss `slain:<type>` flag, so each boss stays down independently and never re-spawns for that save. Two live examples in `src/game/actors/boss.ts`: the **Slime King** (scaled blob, contact + spit) and the **Duelist**, a *human* boss with her own authored sprite (`sprites/duelist.json` → `DUELIST_ANIMS`) — a crimson-coated fencer — who trails afterimage `ghosts` on her dashes and mixes saber `strike`s with ballistic pistol shots (the saber and pistol are code overlays in `draw`, so they animate with her FSM state). The Slime King in full:

```ts
defineMonster('my-boss', {
  hp: 900, damage: 20, w: 42, h: 30, score: 5000, mass: 6,
  boss: true, displayName: 'THE SLIME KING',
  colors: [...], drops: [...],
  init(m) { m.state.fsm = makeFsm(m); },       // states: idle/hop/slam/spit/summon
  update(m, dt) { (m.state.fsm as FSM<Monster>).update(dt); },
  draw(g, m) { /* scaled sprite + crown */ },
});
```

The pattern: every attack is a telegraphed FSM state that ends in a `Strike` or `combat.shoot(...)`, so boss damage carries the same feedback as everything else. Phase changes are just a condition read inside states (`hp <= maxHp/2`). The PlayScene shows the HP bar whenever a `boss: true` monster is alive, sets the `bossDefeated` flag on kill (so it stays dead across saves), and plays the `victory` conversation.

## Saves

`src/game/save.ts` defines the save shape: current room, inventory/equipment/skills, story flags, fired one-shot triggers, best score. Checkpoints happen automatically at every room entrance and on boss defeat; death returns you to the last checkpoint at full HP. To persist a new thing, add it to `SaveData` and bump the `JsonStore` version (old saves invalidate cleanly).

## A song (BGM)

In `src/game/content/music.ts` — songs are step patterns on oscillator tracks (`'noise'` for percussion). Tracks of different lengths drift for free variation:

```ts
defineSong('shop-theme', {
  bpm: 96, div: 2,
  tracks: [
    { wave: 'triangle', volume: 0.06, steps: ['C3','-','G3','-','E3','-','G3','-'] },
    { wave: 'noise', volume: 0.015, steps: ['x','-','-','-'] },
  ],
});
```

Play with `game.music.play('shop-theme')` — rooms pick their track via `props.music` (or the PlayScene's fallback map), and boss rooms override with `boss` while the boss lives. Volume channels (master/music/sfx) live on `game.audio` and persist through the pause menu's OPTIONS page.

## A buff or debuff

In `src/game/content/statuses.ts` — stat modifiers apply for the status's lifetime and remove themselves:

```ts
defineStatus('poison', {
  name: 'POISON', color: COLORS.purpleLight, duration: 4,
  tickEvery: 1,
  onTick(a) { /* chip damage, drip particles */ },
});
```

Apply from anywhere: `player.statuses.apply('poison')` — commonly from a projectile's `onHit` (see the slime ball) or an item's `use` (see the haste draught). Active statuses show as HUD chips with remaining-time bars.

## An NPC (and a shop)

NPCs are friendly actors with a greeting conversation; walk close and press E:

```ts
defineNpc('blacksmith', {
  name: 'BLACKSMITH', sprite: SMITH_SPRITE,
  greet: 'blacksmith-greet',        // a conversation; a choice starting
  shop: 'blacksmith',               // with "SHOW" opens this shop
});
```

Shops are ware lists (`content/shops.ts`): `{ item, price }[]` — prices in gold, coins drop from monsters at 5g each. Place the NPC in a room's `entities` like any monster; the PlayScene routes by registry.

## An enemy attack pattern

The built-ins show the three tiers, all resolving through Strikes/Projectiles so feedback stays uniform:

- **Ranged debuff** (the Slime King's sticky spit): lob a 0-damage projectile whose `onHit` applies a status. Zero-damage hits skip damage numbers and player i-frames automatically.
- **Telegraph → lunge** (devourer, boss slam): a shiver/windup state the player can read, then the attack. Never skip the telegraph — readable attacks are what make hard fights fair.
- **Grab mechanics** (Slime King): `MonsterDef.onPlayerContact` starts the generic held-player FSM, while the definition's `swallow` strategy owns status, release cleanup, colors, and overlay. Devourer's gear theft is likewise its own contact hook. New unusual enemies do not add branches to Player.

## A skill tree node

In `src/game/content/skilltree.ts`. Nodes are stat mods (auto-applied and save-restored) and/or an `onUnlock` hook, arranged on a branch/tier grid the UI reads:

```ts
defineTreeNode<TreeCtx>('w5', {
  name: 'BLOODLUST', desc: 'KILLS RESTORE 1 MP',
  cost: 3, branch: 0, tier: 4, requires: ['w4'],
  // stat effects: mods: { add: { attack: 20 } }
  onUnlock({ player }) {
    player.capabilities.enable('restoreMpOnKill');
  },
});
```

Add the id to a class's `grid` in `content/classes.ts` so the tree screen shows it (keep `requires` chains within one class's grid). Use declarative stat mods for stats, named capabilities/modifiers for mechanics, and imperative unlocks such as `player.skills.learn('nova')` for catalog entries. `onUnlock` re-runs during save restore *and* on every class change, so runtime code depends on semantic capability names rather than tree node ids.

XP itself: monsters grant `def.xp ?? score/20` on kill; the curve lives in the Player's `Progression` constructor (40 XP for level 2, +25 per level after); each level awards a skill point, fully heals, and autosaves.

## A class

In `src/game/content/classes.ts`. A class is a lens on the same knight: base stat mods (stats source `class:<id>`), a skill loadout (which action slots exist, what starts known), and a small tree grid of node ids:

```ts
defineClass('mage', {
  name: 'MAGE', desc: 'The arcane path...', color: '#b46ee6',
  mods: { add: { maxMp: 2 } },
  loadout: [
    { action: 'skill', skillId: 'fireball', startsKnown: true },
    { action: 'skill2', skillId: 'nova' },        // learned via the tree
  ],
  branchNames: ['ARCANA', 'FROST'],
  grid: [['m1', 'm2', 'm3', 'm4', 'm5'], ['g1', 'g2', 'g3']],
});
```

Class change is free from the SKILL TREE screen (up to the class tabs, confirm on another class). It is non-destructive: `Player.setClass` parks the old class's unlocked nodes, strips every effect it granted (tree stat mods, class mods, capabilities, skills), and replays the new class's base kit + remembered nodes — the same idempotent replay saves use. Skill points are one shared pool; each class spends into its own tree. Saves carry `classId` + per-class `trees` (old flat-tree saves migrate by dealing nodes to the class whose grid holds them).

## Parrying & deflection (engine hooks)

The parry is a game mechanic built on three small engine seams on `Actor`:

- `parrying` — while true, `Combat.hit` deflects any incoming blow (unless `pierceInvuln`) and calls the target's `onParried(opts, combat)` instead of dealing damage. The target owns the reaction.
- `hitstun` — a timer (ticked in `tickTimers`) that suspends AI; `Monster.update` freezes the brain while it's > 0, so a parried attacker staggers.
- `Projectile.reflect(vx, vy, damageBonus)` + `Strike.retarget(team, bonus)` — flip a shot to the opposite team and send it back; `Projectile.targetTeam` reads who it currently threatens.

The knight's parry lives in `player.ts` (`beginParry`/`parryUpdate`/`parrySuccess`): a short `parry` FSM state opens a guard window that reflects player-bound projectiles in a front arc, and `onParried` staggers melee attackers. A hit inside the window grants i-frames + a `riposteT` window whose next swing lands harder (see `beginAttack`). The `parry` action is bound in `defs.ts` (keyboard F/H, gamepad RT, touch shield button) and rides `NET_ACTIONS` so co-op guests parry too.

## A new player attack state

Model it like the existing attack (see `Player.beginAttack`):

1. Add an FSM state (or extend `attack`) in `actors/player.ts`.
2. Create a `Strike` with damage/strength/knockback, and `apply()` it during active frames.
3. Feedback comes free via the strike; add a signature flourish (particles, sfx) in the state's `enter`.

## Game-wide reactions (drops, quests, achievements)

Listen to events instead of editing systems:

```ts
game.events.on('kill', ({ target }) => { /* roll a drop, count for a quest */ });
game.events.on('waveClear', ({ wave }) => { /* heal, offer upgrade */ });
```

## Rules of thumb

- Content files register at import time and export nothing; `main.ts` imports them for their side effects.
- Keep every tunable number in the def or a `*_TUNING` object — the whole point is finding the fun by twiddling.
- If two monsters share behavior, extract a helper function in the content file — resist adding engine features until the third use.
