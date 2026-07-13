# Design tools

Two browser-based tools ship with the game: a **level editor** and a **sprite editor**. Both are plain web pages under `tools/` that import the game's own content registries — so anything you register (a tile, a monster) shows up in them automatically, with zero editor changes.

Open them:

| | Local dev (`npm run dev`) | Hosted (GitHub Pages) |
| --- | --- | --- |
| Level editor | `http://localhost:5173/tools/level-editor.html` | `…/hitstop/tools/level-editor.html` |
| Sprite editor | `http://localhost:5173/tools/sprite-editor.html` | `…/hitstop/tools/sprite-editor.html` |

Both tools are **client-only**. Nothing autosaves to the repo — you edit, then explicitly **download** or **export** (copy) the result and paste it into a source file. Shipping content is always a deliberate step (see "Getting your work into the game" in each section).

---

## Level editor

Source: `tools/level-editor.html` + `tools/src/level-editor.ts`.

It edits a **`RoomDef`** (`src/engine/level/room.ts`) — the exact format the game loads rooms from. The tile palette is `tiles.ids()` and the entity palette is `monsters.ids()`, both read live from the registries.

### The four modes

Pick a mode in the left sidebar. Left mouse is the primary action, right mouse erases.

| Mode | Left-click / drag | Right-click |
| --- | --- | --- |
| **tiles** | Paint the selected tile (drag to paint a stroke) | Erase to empty |
| **entities** | Place the selected monster (anchored feet-centered) | Remove the nearest entity |
| **player spawn** | Set the spawn point | — |
| **triggers** | Drag a rectangle → prompts for the event | Remove the trigger under the cursor |

Selecting a tile or a monster from its palette switches you into the matching mode automatically.

### Triggers

Dragging a box in **trigger** mode asks for an event name:

- **`talk`** — prompts for a conversation id (see `src/game/content/conversations.ts`). Fires once by default.
- **`door`** — prompts for a target room id and an optional `x,y` spawn in that room (blank = the target's own `playerSpawn`). Doors re-fire on every entry.
- **anything else** — a custom event; handle it however you like in `PlayScene` (it's emitted on the `trigger` event bus).

### Room settings & JSON

- **name / cols / rows / resize** — rename the room and grow/shrink the tile grid (content is preserved top-left; new cells are empty).
- The **json** textarea always mirrors the current room. **export json** copies it to the clipboard, **import json** loads whatever is in the textarea (validated — a bad room reports the error), and **download** saves it as `<name>.json`.

### Test play

**▶ test play** writes the room to `localStorage['hitstop.room']` and opens the game with `?room=local` in a new tab. On boot, `main.ts`'s `testRoom()` reads that key and hands the room to `PlayScene`, replacing the whole world with your single room — a full edit → play loop in one click.

Notes:
- Test play is **transient**: it lives only in `localStorage`, and is *not* saved into the repo. Closing the tab loses nothing you downloaded.
- The game URL is resolved **relative to the editor page** (`../index.html?room=local`), so it works from a subpath like `…/hitstop/`. If nothing opens, check your **popup blocker** — test play uses `window.open`.

### The RoomDef format

```jsonc
{
  "name": "arena",
  "tileSize": 8,
  "legend": { "#": "rockTop", "=": "rock", "-": "platform", "D": "gate" },
  "tiles": [                    // rows of legend chars; '.' (or any unlisted char) = empty
    "..........----........",
    "======================"
  ],
  "playerSpawn": { "x": 40, "y": 192 },
  "entities": [ { "type": "slime", "x": 300, "y": 200 } ],
  "props": { "waves": "default", "music": "overworld" },   // optional
  "triggers": [
    { "x": 180, "y": 140, "w": 110, "h": 92, "event": "talk", "once": true,
      "props": { "conversation": "intro" } },
    { "x": 928, "y": 200, "w": 16, "h": 32, "event": "door", "once": false,
      "props": { "room": "cavern", "x": 28, "y": 200 } }
  ]
}
```

- **`legend`** maps a character to a tile id from the `tiles` registry. The editor allocates legend chars for you as you paint.
- **`props`** is free-form. The game reads `props.waves` (a wave-table id → the room runs wave combat) and `props.music` (a song id, overriding the per-room default in `PlayScene`).

### Getting your work into the game

1. **download** the room JSON (or copy it via export).
2. Drop it into `src/game/content/rooms/` (e.g. `mylevel.json`).
3. Register it in `src/game/content/rooms/index.ts`:
   ```ts
   import myLevelJson from './mylevel.json';

   export const ROOMS: Record<string, RoomDef> = {
     arena: validateRoom(arenaJson),
     cavern: validateRoom(cavernJson),
     throne: validateRoom(throneJson),
     mylevel: validateRoom(myLevelJson),   // ← add
   };
   ```
4. Reach it in-game by pointing a **door** trigger at its id (`props.room: "mylevel"`), or set it as `START_ROOM`.

---

## Sprite editor

Source: `tools/sprite-editor.html` + `tools/src/sprite-editor.ts`.

Sprites are **text grids**: rows of palette characters plus a `{ char → color | null }` palette (`src/engine/gfx/sprite.ts`). Each sprite/character is one **JSON file** under `src/game/content/sprites/` — a palette plus a set of **named animations**, which is exactly what the editor imports and exports:

```jsonc
{
  "hd": true,                 // EPX-upscale to the game's 4x texel density at load
  "palette": { "S": "#a8b8c8", "R": "#b13e53" },   // extends the shared PAL
  "anims": {
    "idle": { "fps": 2,  "frames": [ ["...PP...", "..OPPO.."], ["…"] ] },
    "run":  { "fps": 10, "frames": [ ["…"], ["…"] ] },
    "air":  { "fps": 1,  "frames": [ ["…"] ] }
  }
}
```

A single static sprite is just one animation with one frame. `loadSprite` (`src/engine/gfx/spritefile.ts`) bakes these files; `src/game/content/sprites.ts` wires the loaded frames to the names the game uses.

### Controls

- **Paint / erase** — left-drag paints the selected palette character; right-drag erases (`.` = transparent).
- **palette** — click a swatch to select it; **add** takes a character + color and adds it to the file's palette.
- **animations** — a button per animation; click to edit it. **+ anim** / **rename** / **del**, and an **fps** for the selected one.
- **frames** — numbered buttons switch frames within the selected animation. **+ frame** (blank), **dup**, **del**.
- **size (w × h) → resize** — reshape every frame across all animations (content preserved top-left), keeping the sprite uniform.
- **preview** — plays **every animation at once** at its own fps. The **hd** checkbox toggles between the raw art and the EPX-upscaled version the game actually renders, at the same on-screen size.
- **export** copies the sprite JSON to the clipboard; **import** loads whatever is in the textarea (the older single-animation `{ palette, frames, fps }` shape is accepted too).

### Getting your work into the game

1. **export** the sprite JSON and save it as `src/game/content/sprites/<name>.json` (or edit an existing one — paste it into the editor's textarea and **import** to round-trip it).
2. Load it in `src/game/content/sprites.ts` and wire the frames to names:
   ```ts
   import goblinJson from './sprites/goblin.json';
   const goblin = load(goblinJson);
   export const GOBLIN_ANIMS = withFacing(goblin.animSet());   // animated actor
   export const GOBLIN_IDLE = goblin.frame('idle', 0);          // a single frame
   ```
3. **Custom colors** — palette characters added in the editor travel *in the file* (`palette`), so they just work. Put a color in `PAL` (`src/game/content/palette.ts`) only if you want it shared across sprites.

---

## Why the tools never drift

Neither tool hardcodes content. The level editor's palettes are `tiles.ids()` / `monsters.ids()`; the sprite editor seeds from `PAL`. Register a new tile or monster (see [`adding-content.md`](adding-content.md)) and it appears in the editor on the next reload — no editor edits, ever. That's the same registry-driven design the engine itself uses (see [`architecture.md`](architecture.md)).
