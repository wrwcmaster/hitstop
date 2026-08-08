# Design tools

Two browser-based tools ship with the game: a **level editor** and a **sprite editor**. Both are plain web pages under `tools/` that import the game's own content registries — so anything you register (a tile, a monster) shows up in them automatically, with zero editor changes.

Open them:

| | Local dev (`npm run dev`) | Hosted (GitHub Pages) |
| --- | --- | --- |
| Level editor | `http://localhost:5173/tools/level-editor.html` | `…/hitstop/tools/level-editor.html` |
| Sprite editor | `http://localhost:5173/tools/sprite-editor.html` | `…/hitstop/tools/sprite-editor.html` |

The hosted tools are **client-only**. During local development the sprite editor also has a revisioned collaboration bridge: a browser and an agent can share the active sprite and preview, while **save to repo** remains an explicit action. The level editor and hosted sprite editor still download/export only.

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

- **color picker** - choose **picker** in the top toolbar, or hold Alt to temporarily sample from the current frame without losing the previously selected tool. The palette highlights the sampled character immediately. Shift+Alt-click remains the shortcut for placing a selected frame anchor.
- **select / clipboard** - drag a pixel rectangle, then cut/copy/paste it with the toolbar or Ctrl/Cmd+X/C/V. Paste uses the selection's top-left as its destination and clips safely at the frame edge. Copy also writes a self-describing JSON envelope to the system clipboard; Escape or right-click clears the selection. The toolbar shows its bounds and confirms that the region is shared with the agent bridge.

- **Paint / erase** — left-drag paints the selected palette character; right-drag erases (`.` = transparent).
- **palette** — click a compact color-grid swatch to select it; hover for its character and hex value. **add** takes a character + color and adds it to the file's palette. Swatches are display-sorted into neutral and hue/lightness ramps so related colors stay together; their palette characters and frame data are not reordered.
- **animations** — a button per animation; click to edit it. **+ anim** / **rename** / **del**, and an **fps** for the selected one.
- **frames** — numbered buttons switch frames within the selected animation. **+ frame** (blank), **dup**, **del**.
- **size (w × h) → resize** — reshape every frame across all animations (content preserved top-left), keeping the sprite uniform.
- **top toolbar** — keeps pencil, fill, select, cut/copy/paste, zoom out, an editable percentage, zoom in, and **fit** available without scrolling either side panel.
- **zoom / fit** — zoom is shown as a percentage (100%–6400%); **− / +** step through useful editing scales and **fit** chooses the largest scale that keeps the whole frame visible. Grids may be up to 160×160, so the editor can author the 48×80 player and existing 128×128 weapon layers directly.
- **preview** — plays the selected animation at its authored fps. The **hd** checkbox toggles between the raw art and the EPX-upscaled version the game actually renders, at the same on-screen size.
- **existing sprite** is populated recursively from every `.json` file under `content/sprites/`, including nested equipment sheets; the reference selector uses the same catalog. **load file / download** can open any other `.json` sprite from disk and download the current one. **export / import** are the clipboard/textarea equivalents (the older single-animation `{ palette, frames, fps }` shape is accepted too).

### Live agent collaboration

Under `npm run dev`, Vite hosts a development-only, loopback-only bridge at `/__sprite-editor`. Open a sprite directly with `tools/sprite-editor.html?sprite=knight.json`. The status in the header shows its shared revision and whether it has unsaved changes.

- Browser edits publish the complete `SpriteFile` after each stroke. An agent reading `GET /__sprite-editor/state` therefore sees the user's current work, including changes not written to disk yet.
- Agent edits use `PUT /__sprite-editor/state`; the open browser receives them immediately over a server-sent event and adds the previous version to undo history.
- Every write supplies `baseRevision`. A stale write receives `409 revision conflict`, so neither side silently overwrites the other.
- `GET /__sprite-editor/preview.png` returns the editor's real preview canvas for the active revision, including the selected composite, equipment, weapon, and hitbox settings.
- `GET /__sprite-editor/selection` returns the active animation, frame, bounds, and exact text-grid rows. Selection is transient collaboration metadata: pointing at art never dirties the sprite or advances its document revision.
- **save to repo** (or `POST /__sprite-editor/save`) is the only operation that writes under `src/game/content/sprites/`. Paths are confined to that directory and sprite JSON is validated before it enters the shared document.

The useful endpoints are:

| Endpoint | Purpose |
| --- | --- |
| `GET /__sprite-editor/sprites` | List editable repository sprite paths |
| `POST /__sprite-editor/open` `{ path, source, force? }` | Open a repository sprite; refuses to discard a dirty shared document unless explicitly forced |
| `GET /__sprite-editor/state` | Read `{ path, file, revision, source, dirty }` |
| `PUT /__sprite-editor/state` `{ path, file, baseRevision, source }` | Replace the live document without saving it |
| `GET /__sprite-editor/selection` | Read the active pixel selection and its rows |
| `PUT /__sprite-editor/selection` `{ selection }` | Share or clear transient selection metadata without editing the document |
| `GET /__sprite-editor/events` | Subscribe to live `state` events |
| `GET /__sprite-editor/preview.png` | Inspect the active visual preview |
| `POST /__sprite-editor/save` `{ path?, baseRevision, source }` | Explicitly write the active revision to the repo |

Browser automation can use `window.__editor`: `open(path)`, `replace(file, path)`, `setPixels(...)`, and `save()` are the mutation seam; the existing file, selection, edit-version, and bridge getters expose observation. The HTTP API is preferable for an agent that does not need to drive the UI.

`npm run agent-sprite -- <command>` is a thin CLI over that HTTP API. It supports `list`, `open`, `state`, `selection`, `preview`, `apply`, and `save`. The `selection` command is the handoff seam for requests such as "fix this eye": it gives the agent unambiguous frame coordinates and the selected pixel rows. `open` refuses to throw away unsaved shared work; pass `--force` only after deliberately deciding to discard it. Set `SPRITE_EDITOR_URL` when Vite uses a port other than 5173; for example, in PowerShell: `$env:SPRITE_EDITOR_URL='http://127.0.0.1:5174'`.

For the end-to-end workflow from generated concept to approved animation-ready JSON, including comparison gates and pixel-polish rules, see [Sprite art pipeline](sprite-art-pipeline.md).

### Frame anchors

Sprites may carry named attachment points under `anchors` (`frontHand`, `rearHand`, `head`, and future points). Choose one in the **anchors** panel; its x/y values are logical pixels from the sprite's top-left. Shift+Alt-click the grid to place it on the selected frame. Anchor arrays follow frame add/duplicate/delete, animation rename/delete, undo/redo, and nudge operations so art and equipment cannot silently drift apart.

The full-player composite re-bakes unsaved edits to `knight.json`, registered gear layers, and sprite-backed weapons. This makes the collaboration bridge useful before saving: an agent can change the shared document and the human immediately sees the actual player/equipment result, not a stale disk-loaded mannequin.

### Composite preview: sprites in company

Pixel art for this game is rarely seen alone — an attack is the knight's body, the weapon in her hand, and the slash effect sweeping over both. The **composite** panel previews that joint effect, drawn by the game's *own renderers* (`drawHeldWeapon`, `drawWeaponTrail`), not an editor imitation. The weapon's per-frame anchors and the slash trail are code, not sprites, so no sprite-only overlay could show it truthfully.

- **weapon** — any registered weapon; the composite shows the body holding it, and on animations that have an attack (the weapon type's moveset names them), the attack pose and slash trail play on one clock: the attack's real duration plus a beat of hold.
- **move** — which of the weapon's moves to pose: the combo swings and the contextuals (aerial, plunge, upper, dash). They usually share ONE sheet animation while differing in trail, timing, aim and body motion — the sheet alone cannot say which move you are looking at, so the label always names it. Auto = the opening combo swing.
- **body** — the sheet being edited, the raw knight sheet, or **player (full)**: a real `Player` instance posed via `Player.poseAttack`, so the composite is the actual in-game knight — attack body-english (lean, shear), gear layers, held weapon and trail, all from `Player.render` itself. She is constructed against no-op stand-ins for the game and tilemap; posing draws, it never simulates. Loading a weapon sheet (`equipment/*.json`) selects this automatically — the view you want when touching up a sword's attack frames.
- **gear (helmet + plate)** — equips the iron helmet and steel armor on the full player, so you can check art against the armored silhouette too.
- **live re-bake** — while a weapon sheet is being edited, every stroke re-bakes it into its registered visual (via `rebuildSpriteWeapon`), so the composite shows your edits in the knight's hand as you paint. The art swaps; the origins and anchors stay.
- **attack hitbox** — draws the move's hit region, placed by the same rules as Player.attackBox: a dim outline while merely placed, red while the active window makes it able to hit. The one view where art, trail and hitbox can disagree in front of you.
- **attack trail** — toggles the slash effect, on the full player too (a tooling-only knob on Player; the game itself never hides a swing's trail).

Pick `-- no weapon --` to return to the plain preview.

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

## Sprite-sheet slicer (PNG)

The slicer is also the **sprite animation workbench**: it is the approval stage
between an ImageGen candidate and game-native JSON. Load a local PNG or a
workspace URL, optionally remove a chroma key, use **detect frames** to find
separated figures, and align every crop inside one shared bottom-centered
frame. The animation preview follows the active **generated source** or
**normalized pixels** view, so it always shows the stage being reviewed.
Enable **fit shared content bounds** after alignment to crop one union box over
all frames; it never rescales frames or changes their relative motion. The
top/right/bottom/left shared-trim values can then crop additional logical
output pixels identically from every frame.
Frame alignment also offers an opt-in per-frame scale percentage. Keep it at
100 for a coherent generated sheet; use it only to correct measurable scale
drift between separately generated frames, matching corresponding poses by
head, torso, and limb proportions rather than forcing every pose to the same
height.
Preview **− / +** changes its zoom independently from the sheet, **fit** fits
the current stage, and the scrollable viewport keeps large source frames usable.
**previous** overlays the prior frame to expose baseline drift and silhouette
flicker.

Use **generated source** to judge the model output, then **normalized pixels**
to inspect the actual target-size, palette-limited cells produced by cropping
and reduction. **coverage-aware pixel reduction** integrates every source pixel
that contributes to a destination cell. Palette selection then gives extra
weight to bounded local contrast, preserving small details without rules for a
specific hue or brightness. **nearest-neighbor sampling** remains available as
a diagnostic comparison. Do not infer a pseudo-pixel lattice from generated
art unless its block size and phase are known to be consistent.

For a multi-generation animation whose material colours drift, select
**frame 0 reference** as the palette source. This makes every frame use the
approved first frame's exact colour set. If colours still cross materials
(for example, trousers borrow the scarf ramp), enable **harmonize frame shading
to frame 0**. It adds a vertical-neighbourhood cue to colour matching, so the
same palette can distinguish scarf, torso, trousers, and boots while preserving
the later frame's pose and clusters. It is opt-in because a real lighting or
palette-changing animation should keep its authored colour shift.
Before conversion, approve the generated source, normalized identity/silhouette,
motion/cadence, and origin/baseline. **export normalized png** saves that
approved image-stage artifact. **to sprite json** remains locked until all four
approvals are set, so animation is never silently authored by post-conversion
JSON transforms.

The workbench is URL-stateless for workspace images: its mode, view, sheet and
preview zoom,
crops, offsets, animation definitions, chroma key, target size, and conversion
controls are encoded in the current URL. Refreshing or sharing that URL rebuilds
the same review state; approvals intentionally reset and must be confirmed by
the reviewer again. Local file uploads cannot survive refresh because browsers
do not allow a page to reopen an arbitrary local file.

Agent review reads the workbench's own normalized canvas through the read-only
`window.__sheetSlicer.normalized()` bridge. **Export normalized png** also mirrors
that exact data URL into the hidden `#agentNormalized` field for browser drivers
running in an isolated page world. Both paths reuse the interactive pipeline;
agents must not reimplement normalization in a separate script.

When a real subject detail is close to the chroma key, use **protect subject
color** in generated-source view. Click a detail to place the configured-size
mask, or drag a tight custom rectangle over it. Chroma
transparency and spill removal skip protected regions; key-adjacent subject
colors in them are also carried through reduction and reserved in the palette.
The cyan regions are part of the URL state, so refresh and handoff preserve the
mask without hidden browser storage. Right-click a region to remove it, or use
**clear protection**.

Gemini image outputs may include a small sparkle watermark on the reserved
magenta field. The ordinary chroma-key and spill-suppression stage removes it;
verify that the normalized PNG contains only the subject before approval. Keep
the source PNG unchanged as the audit/reference artifact.

When there is exactly one corresponding protected region per frame, **lock one
protected feature per frame to frame 0** makes frame 0's reduced pixels the
canonical cluster for those regions. This removes sampling flicker from tiny
fixed identity details such as an iris. Leave it off when the protected feature
is meant to deform or change during the animation.

Source: `tools/sheet-slicer.html` + `tools/src/sheet-slicer.ts`.

The text-grid format is great for small hand-drawn sprites, but for **full-colour art** — a sheet drawn elsewhere (an illustration tool, an image model, a marketplace asset) — use a PNG **sprite sheet** instead. The slicer turns a sheet into a **descriptor** the game loads with `loadSheet` (`src/engine/gfx/spritesheet.ts`).

### Slicing a sheet

1. **load png** — pick your sheet. Use the **zoom** −/+ (or Ctrl/⌘ + scroll) to inspect it.
2. Choose how to cut it — two modes:
   - **grid** — uniform cells: set `frame w/h`, plus `margin` (border) and `spacing` (gap) if the frames aren't flush. Frames are numbered left→right, top→bottom.
   - **rects** — for **irregular sheets**. Set a default **new frame w/h**, then add frames three ways: **tap a blank spot** to drop a default-sized frame there, **drag a rectangle** for a custom size, or **+ frame** to add one you position by number. **Drag an existing frame to move it**; right-click it to remove it. Every frame is also editable as `x/y/w/h` in the list.
3. Set **texel** — how many source pixels equal one logical pixel. This sizes the sprite on screen: a 32-px-wide frame with `texel: 2` draws 16 logical px wide (matching text-grid sprites, whose logical size is their grid width). Lower `texel` = bigger on screen.
4. Add **animations** — each gets a name, a comma-separated **frame list** (the numbers on the overlay), and an fps. The preview plays every animation live.
5. Export, two ways:
   - **export descriptor** copies a `SheetDescriptor` (grid mode emits `frameW/frameH/margin/spacing`; rects mode emits an explicit `rects` array) — the game keeps the PNG and slices it at load with `loadSheet` (see "Using a sheet in the game").
   - **to sprite json** converts the sliced frames straight into a **text-grid sprite JSON** — no runtime PNG needed. See below.

### Converting a sheet to sprite JSON

**to sprite json** turns the slices into the engine's native text-grid format (the same `{ palette, anims }` the sprite editor uses), so the result loads through the ordinary `loadSprite` path and is fully editable in the **sprite editor** — one unified pipeline, no PNG shipped.

- Conversion reads the approved normalized pixels without another resize or
  color reduction. Set
  `texel` to `4` for dense 4x art (`hd: false`) or `1` for logical-resolution
  art (`hd: true`).
- Colours are quantized with edge-weighted median cut to a palette of at most
  **70 max colors** entries, then every opaque source color is mapped to its
  nearest palette entry (fully-transparent pixels become `.`). Local contrast
  gives small bounded details more influence without hue-specific rules. Lower
  the limit for a tighter palette or raise it for fidelity; dense character art
  defaults to 32. The flash message reports how many colours the export used.
- The output copies to the clipboard; **paste it into the sprite editor** to tweak, or save it as `src/game/content/sprites/<name>.json` and wire it up exactly like any hand-drawn sprite. This is the best route for **pixel-art** sheets; keep `loadSheet` (below) for genuinely full-colour illustration where a small palette would lose too much.

### Using a sheet in the game

Save the PNG under `src/game/content/sprites/` (e.g. `knight.png`) and the descriptor next to it (`knight.sheet.json`). Then swap the player's art in `main.ts`, before `game.start()`:

```ts
import knightPng from './content/sprites/knight.png';        // Vite gives a URL (inlined in the single-file build)
import knightSheet from './content/sprites/knight.sheet.json';
import { loadKnightSheet } from './content/sprites';
// ...
await loadKnightSheet(knightPng, knightSheet as SheetDescriptor);
```

`loadKnightSheet` decodes the image, slices it, and swaps `KNIGHT_ANIMS` / `KNIGHT_IDLE_SPRITE` (ES-module live bindings, so the player and title screen pick it up). For any other actor, call `loadSheet(image, descriptor)` and use the returned `frame()` / `animSet()` exactly like a text-grid sprite. The animation names the game expects for the player are `idle`, `run`, and `air`.

---

## Why the tools never drift

Neither tool hardcodes content. The level editor's palettes are `tiles.ids()` / `monsters.ids()`; the sprite editor seeds from `PAL` and discovers `content/sprites/**/*.json` at build time. Register a new tile or monster, or add a sprite JSON file (see [`adding-content.md`](adding-content.md)), and it appears in the editor on the next reload — no editor edits, ever. That's the same data-driven design the engine itself uses (see [`architecture.md`](architecture.md)).
