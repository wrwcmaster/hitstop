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

1. **Sprite editor** (`/tools/sprite-editor.html`): paint, animate, export — then paste rows into a `sprite([...], PAL)` call in `src/game/content/sprites.ts`.
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

## A new player skill / attack

Model it like the existing attack (see `Player.beginAttack`):

1. Add an FSM state (or extend `attack`) in `actors/player.ts`.
2. Create a `Strike` with damage/strength/knockback, and `apply()` it during active frames.
3. Feedback comes free via the strike; add a signature flourish (particles, sfx) in the state's `enter`.

For charge attacks / spells, the pattern is the same — a state with a windup timer, then a strike (or a spawned projectile `Entity`).

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
