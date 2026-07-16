# Adding content: a cookbook

Everything here follows the same pattern: **register a definition, and the engine + tools pick it up.** No engine edits, no editor edits.

## A new enemy (~20 lines)

Create the definition (in `src/game/actors/enemies.ts`, or a new file you import from `main.ts`):

```ts
defineMonster('spitter', {
  hp: 4, damage: 1, w: 14, h: 10, score: 250,
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

It immediately appears in the level editor's tile palette. (Damage-on-touch would be a small `World` system: check actors overlapping spike tiles — see `World.systems`.)

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

A weapon is an equipment item whose `props.weapon` carries the attack spec the player's swing reads:

```ts
defineItem<ItemCtx>('dagger', {
  name: 'DAGGER', desc: 'Fast and mean.',
  icon: ICON_DAGGER, kind: 'equipment', slot: 'weapon',
  props: {
    weapon: {
      lightDamage: 1, heavyDamage: 2,
      lightStrength: 0.3, heavyStrength: 0.6,   // feel scale per hit
      reach: -4,                                 // hitbox size delta
      colors: [COLORS.white],
      bladeLen: 5, bladeW: 1, blade: COLORS.steel, hilt: COLORS.gold,
    } satisfies WeaponSpec,
  },
});
```

No player-code changes: damage, feel strength, reach, slash colors all flow from the equipped item. Stat bonuses (`mods: { add: { attack: 1 } }`) stack on top.

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
      strike: { damage: 1, targets: 'enemy', attacker: player, strength: 0.5 },
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

## A boss

A boss is a monster with `boss: true`, a `displayName` (drives the HP bar), and an engine `FSM` in its state — see `src/game/actors/boss.ts` for the full Slime King:

```ts
defineMonster('my-boss', {
  hp: 45, damage: 1, w: 42, h: 30, score: 5000, mass: 6,
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
  // stat effects: mods: { add: { attack: 1 } }
  onUnlock({ player }) {
    player.capabilities.enable('restoreMpOnKill');
  },
});
```

Add the id to `TREE_GRID` so the tree screen shows it. Use declarative stat mods for stats, named capabilities/modifiers for mechanics, and imperative unlocks such as `player.skills.learn('nova')` for catalog entries. `onUnlock` re-runs during save restore, so runtime code depends on semantic capability names rather than tree node ids.

XP itself: monsters grant `def.xp ?? score/20` on kill; the curve lives in the Player's `Progression` constructor (40 XP for level 2, +25 per level after); each level awards a skill point, fully heals, and autosaves.

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
