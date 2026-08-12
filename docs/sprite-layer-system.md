# Sprite layer system

Status: first release implemented. Flat sprites remain valid; layered sprites now round-trip through the editor and bridge and are baked by the engine into the existing runtime frame cache.

## Decision

Layers will be a **first-class part of the generic sprite source format**, not an editor-only sidecar and not a set of live gameplay objects.

The engine will validate and composite a layered `SpriteFile` when it lazily bakes an animation frame. The rest of the runtime will continue to receive the same single `HTMLCanvasElement` per frame from `LoadedSprite`. Actors will not know which authoring layers produced that canvas.

Gameplay-controlled visuals remain separate runtime composition passes:

- A body sprite may internally contain authored layers such as body, hair, scarf, and touch-up.
- A helmet, armor item, or weapon remains its own registered asset because gameplay decides whether it is equipped.
- Trails, hit flashes, swallowed overlays, and other effects remain renderer behavior.
- Any of those separate assets may itself use authored layers; `loadSprite` flattens them in the same way.

This is a hybrid boundary: **authoring layers are preserved in the file and flattened by the engine; semantic game layers are selected and drawn by game systems.**

## Why this boundary

There are three plausible designs.

| Design | Advantage | Cost | Decision |
| --- | --- | --- | --- |
| Editor-only layered project, exported to flat game JSON | No engine format change | Two sources of truth, lossy round trips, easy to save the project but forget the export, and ambiguous agent/browser collaboration | Reject |
| Every authored layer is drawn separately during gameplay | Runtime can toggle any layer | More draw calls, layer names leak into actors, ordering becomes gameplay state, and editor concepts become runtime API | Reject |
| Layered sprite source, flattened by `loadSprite` | One source of truth, full round trip, generic engine mechanism, unchanged actor API and nearly unchanged draw cost | Requires a format and loader extension | Adopt |

The existing player renderer already demonstrates why the distinction matters. It draws the body, equipped gear, held weapon, foreground grip, and effects in a meaningful runtime order. Those are not Photoshop layers: they come from registries and player state. Folding them into `knight-v2.json` would create a combinatorial costume sheet and bypass the equipment registries.

At the same time, forcing hair, scarf, face, and correction paint into one text grid makes ordinary art revision destructive. Those are authoring concerns and belong in the sprite asset.

## Terminology

- **Authoring layer**: a named, ordered pixel track inside one sprite file. It is always flattened before an actor draws the sprite.
- **Runtime visual layer**: a separately loaded asset or effect chosen by game state, such as equipped armor or a held weapon.
- **Timeline**: animation names, frame counts, speed, looping, and aliases shared by every authoring layer.
- **Track**: one authoring layer's pixel frames for one timeline animation.
- **Composite**: the visible result of stacking authoring layers from bottom to top.

Calling both concepts “layers” is convenient in the UI, but the implementation must keep the distinction explicit.

## Proposed source format

Current flat sprite files remain valid and require no migration. A flat file is interpreted as one implicit layer named `Base`.

A new layered file uses the same geometry, palette, anchors, `hd`, and `anims` concepts, but centralizes timing in the animation timeline and stores pixels in layer tracks:

```jsonc
{
  "hd": false,
  "w": 20,
  "h": 27.5,
  "palette": {
    ".": null,
    "O": "#171625",
    "H": "#b9682e",
    "S": "#31505b"
  },
  "anims": {
    "idle": { "fps": 4, "frameCount": 5 },
    "run": { "fps": 10, "frameCount": 8 },
    "air": "idle"
  },
  "layers": [
    {
      "id": "body",
      "name": "Body",
      "tracks": {
        "idle": [ ["...OO...", "..O..O.."], ["...OO...", "..O..O.."] ],
        "run":  [ ["...OO...", "..O..O.."] ]
      }
    },
    {
      "id": "hair",
      "name": "Hair",
      "tracks": {
        "idle": [ ["...HH...", "..H....."], ["..HHH...", "..H....."] ],
        "run":  [ ["...HH...", "..H....."] ]
      }
    },
    {
      "id": "scarf",
      "name": "Scarf",
      "tracks": {
        "idle": [ ["........", "...SS..."] ],
        "run":  [ ["........", "..SSS..."] ]
      }
    }
  ],
  "anchors": {
    "frontHand": { "idle": [{ "x": 8, "y": 14 }] }
  }
}
```

The example abbreviates repeated frames. Real tracks must obey the invariants below.

The TypeScript shape should be a union rather than making every consumer handle partially mixed data:

```ts
type SpriteFile = FlatSpriteFile | LayeredSpriteFile;

interface LayeredSpriteAnimData {
  fps: number;
  frameCount: number;
  loop?: boolean;
}

interface SpriteLayerData {
  id: string;
  name: string;
  tracks: Record<string, string[][]>;
}

interface LayeredSpriteFile extends SpriteGeometry {
  palette?: Palette;
  hd?: boolean;
  anchors?: SpriteAnchors;
  anims: Record<string, LayeredSpriteAnimData | string>;
  layers: SpriteLayerData[];
}
```

Stable `id` values are for files, undo history, local drafts, and agent instructions. Display `name` values may change freely.

### Format invariants

The loader and editor enforce these rules rather than repairing malformed content silently:

1. Layer ids are unique, non-empty, and stable.
2. There is at least one layer.
3. The timeline owns `fps`, `loop`, aliases, and frame count. A layer cannot create its own timing.
4. Every non-aliased animation has a track on every layer with exactly the timeline's frame count. A newly created track is filled with transparent frames.
5. Every frame uses the same grid dimensions. Layers do not change sprite geometry, collision, or feet origin.
6. Palette entries resolving to `null` are transparent. For every cell, the topmost non-transparent character wins.
7. Anchors remain sprite-global and frame-aligned. They do not belong to a paint layer.
8. Layer array order is bottom to top.
9. Initial support uses normal, fully opaque indexed-pixel compositing only.

Requiring complete tracks is intentionally stricter than treating a missing track as transparent. It makes frame duplication, reordering, undo, validation, and agent edits deterministic. The editor creates the transparent data automatically, so artists do not pay the bookkeeping cost.

## Engine behavior

`src/engine/gfx/spritefile.ts` remains the mechanism boundary.

For a flat sprite, `loadSprite` behaves exactly as it does now. For a layered sprite it will:

1. Resolve the timeline animation and aliases.
2. Validate every layer track against the resolved animation.
3. Composite palette characters into one text grid for the requested frame.
4. Apply EPX when requested.
5. Bake and cache one canvas using the existing `sprite()` path.

The composite should happen on character grids before rasterization. This preserves exact palette indices, keeps transparent pixels unambiguous, and avoids canvas alpha or color-rounding differences. The cache key remains the resolved animation and frame, so after the first request gameplay draws exactly one canvas just as it does today.

`LoadedSprite`, `AnimSet`, `frameAt`, facing flips, hit flashes, tints, anchors, and game renderers need no layer-aware API. That is the principal architecture test: adding an authored hair layer must not require a change to `Player`, `Monster`, or `Npc`.

## Editor behavior

The layer panel belongs beside the animation/frame workspace because all three select the current editing target:

> sprite → animation → frame → layer

The persistent preview stays separate from tabs and always shows the composite result.

### First release

The layer panel supports:

- create, duplicate, rename, delete, and reorder;
- select the active layer;
- temporary show/hide and solo for inspection;
- lock against painting and transforms;
- merge down and flatten, both undoable;
- a clear indication when the active layer is hidden or locked.

Canvas tools modify only the active layer. Selection, magic selection, fill, color alignment, brush, blur, cut, paste, move, resize, and rotation therefore stop destroying unrelated features. The color picker samples the visible composite by default, with a later option to sample the active layer only.

Frame operations are timeline operations. Adding, duplicating, deleting, or moving a frame changes every layer track and every anchor array atomically. Animation rename, duplicate, and delete similarly affect the timeline and all tracks together.

Onion skin and animation preview render full composites. Copying a selection copies active-layer pixels unless the user explicitly chooses a future “copy composite” command.

### Visibility and production output

Photoshop-style eye and lock controls are editing state, not gameplay state. Temporary visibility, solo, active layer, and locks are stored in the existing local draft/session metadata and ignored by the engine. Saving while a layer is temporarily hidden must not accidentally remove that art from the game.

If permanent exclusion is ever needed, it should be an explicit content operation such as deleting the layer or moving it to a separate reference document—not an eye icon with ambiguous export behavior.

### Undo, drafts, and save

- Undo/redo snapshots the whole layered document so cross-layer frame edits are atomic.
- Local drafts include the layered file plus active layer and view state.
- Save writes the entire layered sprite without changing selected sprite, animation, frame, layer, composite body, or playback position.
- Switching documents restores each document's unsaved layered draft just like current flat drafts.

## Agent and collaboration behavior

The browser bridge remains document-based: its `file` payload contains the complete layered `SpriteFile`. Layer edits use stable layer ids, never array positions alone.

Shared selections should add `layerId` to the existing path, animation, frame, rows, and mask context. An agent can then receive precise instructions such as “move the selected pixels on `hair` in run frame 3” without guessing which visible feature owns them.

Preview endpoints continue to return the composite. A future diagnostic endpoint may render one named layer, but the default preview must match the game.

Conflicts remain file-revision conflicts in the first release. Per-layer collaborative merging would add substantial complexity and is not required for browser/agent turn-taking.

## Relationship to equipment and weapons

The current game order remains:

1. flattened body sprite;
2. equipped gear assets ordered by the gear registry;
3. held weapon asset attached through body and weapon anchors;
4. foreground grip;
5. action effects.

“Body / iron helmet / rusty sword” in the composite preview is not the same list as “Body / Hair / Scarf” in the layer panel. The former is a runtime composition controlled by registries; the latter is internal authoring structure of the currently selected asset.

The editor may present both in one Animate workspace, but it should label them separately—for example **Layers** and **Composite parts**—and never allow reordering an equipment item into the body file.

## Deferred features

The first implementation intentionally excludes:

- opacity, antialiasing, and canvas-style blend modes;
- layer masks and clipping groups;
- nested layer groups;
- adjustment layers;
- game code toggling authored layers by id;
- separate palettes per layer;
- per-layer geometry, hitboxes, anchors, or animation timing;
- real-time multi-user merging.

These features conflict with the current indexed, hard-pixel format or add workflow complexity before the core layer model is proven. Masks can later be represented as ordinary indexed grids if a concrete art workflow justifies them.

## Implementation sequence

1. **Format and pure compositor** — add the layered union, validation, text-grid compositor, and unit coverage while keeping every existing flat file byte-compatible.
2. **Loader integration** — teach `loadSprite` to lazily bake layered frames and verify identical runtime output for a flattened fixture.
3. **Editor document model** — add the layer panel, active-layer editing, composite canvas, atomic timeline operations, undo, and local-draft state.
4. **Tool integration** — make selections, clipboard, transforms, palette compression, magic selection, color alignment, and the collaboration bridge layer-aware.
5. **Composite verification** — verify body, gear, weapon anchors, animation stepping, save-all, reload, and agent preview with a temporary layered fixture.
6. **First production migration** — split one low-risk sprite, then `knight-v2.json`, only after flat and layered output can be compared pixel-for-pixel.

This is a tools plus engine change. It needs typecheck and production build, browser verification of the editor, and a running-game visual comparison. Because the engine loader changes, `hitstop.html` must be rebuilt when implementation begins; this design-doc-only change does not require it.

## Acceptance criteria

The design is successful when:

- a flat sprite loads and edits exactly as before;
- a layered sprite round-trips through editor, bridge, repository, and game without flattening or data loss;
- changing a layer does not touch pixels in another layer;
- frame operations cannot desynchronize layers or anchors;
- the composite preview and game render are pixel-identical;
- gameplay still draws one baked body canvas per frame;
- equipment and weapon registries remain the only source of runtime loadout composition;
- no actor imports or depends on sprite authoring layer ids.

## First-release implementation

The first release follows the boundary above:

- `SpriteFile` is a flat-or-layered union with strict layered validation, shared animation timing, stable layer ids, and character-grid compositing in `spritefile.ts`.
- `loadSprite` still exposes one cached canvas per animation frame. Game actors and the player/equipment render order are unchanged.
- The Animate workspace owns the layer panel. It supports active-layer selection, create, duplicate, rename, delete, front/back reorder, hide, solo, lock, merge down, and undoable flatten.
- Paint, soft brush, blur, fill, magic selection, clipboard, move, resize, and rotation operate on the active layer. The grid, onion skin, picker, and persistent preview use the visible composite.
- Frame add, duplicate, reorder, and delete update all layer tracks and anchor arrays as one history operation. Palette compaction scans and remaps every layer.
- The collaboration selection payload includes `layerId`, and scripted pixel edits may target a stable `layerId` explicitly.

The migration step remains deliberately separate: existing production sprites have not been split automatically. An artist can add the first layer to convert a flat document losslessly, then save the layered source when the split is intentional.
