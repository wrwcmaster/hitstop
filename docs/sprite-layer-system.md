# Sprite layer system

Status: render-tag release implemented. Flat sprites remain valid; layered sprites round-trip through the editor and can interleave with attached sprites through shared render tags.

## Decision

Layers will be a **first-class part of the generic sprite source format**, not an editor-only sidecar and not a set of live gameplay objects.

The engine validates layered `SpriteFile` data and lazily bakes both its normal flattened frame and per-tag frame canvases. Ordinary actors still receive one `HTMLCanvasElement`; a composite renderer may request tagged canvases when it needs to insert attached art between authored layers.

Gameplay-controlled visuals remain separate runtime composition passes:

- A body sprite may internally contain authored layers such as body, hair, scarf, and touch-up.
- A helmet, armor item, or weapon remains its own registered asset because gameplay decides whether it is equipped.
- Trails, hit flashes, swallowed overlays, and other effects remain renderer behavior.
- Any of those separate assets may itself use authored layers and contribute them to the same ordered tag bands.

This is a hybrid boundary: **the engine exposes generic tagged canvases; game content defines tag order and decides which independently equipped assets participate.**

## Why this boundary

There are three plausible designs.

| Design | Advantage | Cost | Decision |
| --- | --- | --- | --- |
| Editor-only layered project, exported to flat game JSON | No engine format change | Two sources of truth, lossy round trips, easy to save the project but forget the export, and ambiguous agent/browser collaboration | Reject |
| Every authored layer receives an independent z-index | Maximum local control | Cross-asset ordering becomes numeric coordination and every layer participates in runtime sorting | Reject |
| Tagged layer bands shared by body and attachments | One centrally managed order, multi-layer weapons, hand-over-grip art, arbitrary future bands | Composite renderers make one draw call per occupied tag | Adopt |

The existing player renderer already demonstrates why the distinction matters. It draws the body, equipped gear, held weapon, foreground grip, and effects in a meaningful runtime order. Those are not Photoshop layers: they come from registries and player state. Folding them into `knight-v2.json` would create a combinatorial costume sheet and bypass the equipment registries.

At the same time, forcing hair, scarf, face, and correction paint into one text grid makes ordinary art revision destructive. Those are authoring concerns and belong in the sprite asset.

## Terminology

- **Authoring layer**: a named pixel track inside one sprite file, assigned to exactly one render tag.
- **Runtime visual layer**: a separately loaded asset or effect chosen by game state, such as equipped armor or a held weapon.
- **Render tag**: a centrally registered, ordered band shared by every asset in a composite.
- **Timeline**: animation names, frame counts, speed, looping, and aliases shared by every authoring layer.
- **Track**: one authoring layer's pixel frames for one timeline animation.
- **Composite**: the visible result of merging every participating layer in render-tag order.

Calling both concepts “layers” is convenient in the UI, but the implementation must keep the distinction explicit.

## Proposed source format

Current flat sprite files remain valid. A flat file is interpreted as one implicit layer named `Base`; composites give that layer an explicit `renderTag` so its role comes from asset data rather than a player/weapon filename check.

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
      "tag": "body",
      "tracks": {
        "idle": [ ["...OO...", "..O..O.."], ["...OO...", "..O..O.."] ],
        "run":  [ ["...OO...", "..O..O.."] ]
      }
    },
    {
      "id": "hair",
      "name": "Hair",
      "tag": "body",
      "tracks": {
        "idle": [ ["...HH...", "..H....."], ["..HHH...", "..H....."] ],
        "run":  [ ["...HH...", "..H....."] ]
      }
    },
    {
      "id": "scarf",
      "name": "Scarf",
      "tag": "foreground-body",
      "tracks": {
        "idle": [ ["........", "...SS..."] ],
        "run":  [ ["........", "..SSS..."] ]
      }
    }
  ],
  "anchors": {
    "frontHand": { "idle": [{ "x": 8, "y": 14 }] }
  },
  "attachmentSlots": {
    "mainHand": { "anchor": "frontHand" }
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
  tag: string;
  composition?: 'base' | 'overlay';
  tracks: Record<string, string[][]>;
}

interface LayeredSpriteFile extends SpriteGeometry {
  palette?: Palette;
  hd?: boolean;
  anchors?: SpriteAnchors;
  attachmentSlots?: Record<string, { anchor: string }>;
  anims: Record<string, LayeredSpriteAnimData | string>;
  layers: SpriteLayerData[];
}
```

The shared base shape also accepts `renderTag?: string`. Ordinary standalone sprites may omit it and keep the engine's generic `base` tag. Any flat sprite participating in a tagged composite authors the tag explicitly.

Stable `id` values are for files, undo history, local drafts, and agent instructions. Display `name` values may change freely.

### Format invariants

The loader and editor enforce these rules rather than repairing malformed content silently:

1. Layer ids are unique, non-empty, and stable.
2. There is at least one layer.
3. The timeline owns `fps`, `loop`, aliases, and frame count. A layer cannot create its own timing.
4. Every non-aliased animation has a track on every layer with exactly the timeline's frame count. A newly created track is filled with transparent frames.
5. Every frame uses the same grid dimensions. Layers do not change sprite geometry, collision, or feet origin.
6. Every layer has one non-empty render tag registered by the composite's content domain.
7. Palette entries resolving to `null` are transparent. Within one tag, the later non-transparent character wins.
8. Anchors remain sprite-global and frame-aligned. They do not belong to a paint layer.
9. Tag registry order determines cross-tag z-order. Layer array order is only a stable tie-breaker within one tag.
10. Initial support uses normal, fully opaque indexed-pixel compositing only.

`composition` is orthogonal to render order. It defaults to `base`: when a
composite supplies alternate base art (for example, a sword already authored
inside a body attack frame), that layer is replaced. An `overlay` layer remains
visible and contains only item-specific decoration such as rust, an enchantment
glow, blood, or cracks. Render tags still decide whether that decoration sits
behind or in front of hands and effects.

Requiring complete tracks is intentionally stricter than treating a missing track as transparent. It makes frame duplication, reordering, undo, validation, and agent edits deterministic. The editor creates the transparent data automatically, so artists do not pay the bookkeeping cost.

## Engine behavior

`src/engine/gfx/spritefile.ts` remains the mechanism boundary.

For a flat sprite, `loadSprite` exposes the authored `renderTag`, falling back to the generic `base` tag when the asset does not participate in a tagged composite. For a layered sprite it will:

1. Resolve the timeline animation and aliases.
2. Validate every layer track against the resolved animation.
3. Composite either the complete frame or one requested render tag on character grids.
4. Apply EPX when requested.
5. Lazily cache complete and per-tag canvases using the existing `sprite()` path.

The composite happens on character grids before rasterization. This preserves exact palette indices, keeps transparent pixels unambiguous, and avoids canvas alpha or color-rounding differences. Per-tag caches are keyed by tag, resolved animation, and frame.

`LoadedSprite` retains its flat frame API and adds `tags`, `tagFrames`, and `tagAnimSet`. Only renderers that intentionally combine independent assets use those methods. Adding an authored hair layer to a normal monster or NPC still requires no actor change.

## Editor behavior

The layer panel has its own Layers workspace beside the animation/frame workspace because all three select the current editing target:

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

Attachment and ordering are separate mechanisms:

- the character-side slot names a frame-aligned anchor;
- the attached asset's grip anchor determines its local transform;
- every body and attachment layer names a render tag;
- the player render-tag registry supplies the only cross-asset order.

The renderer never assigns semantic tags based on asset kind. Flat body and equipment files declare `renderTag`; layered files tag each layer; procedural visuals declare `renderTags` in their registered content definition. Hand choice (`front`, `rear`, or both while charging) and attachment slot are separate visual data, so a rear-hand item does not require a new renderer branch or a special tag.

The initial ordered bands are `behind-body`, `body`, `front-hand-held-object`,
`foreground-body`, and `foreground-effects`. A body hand layer tagged
`foreground-body` therefore covers a weapon blade tagged `front-hand-held-object`.
A weapon may also contribute its blade to `front-hand-held-object` and its glow to
`foreground-effects`; both layers use the same attachment transform.

When an attack body embeds the shared weapon silhouette and pose, the renderer
does not special-case a weapon id or animation name. It draws the body-authored
base and then draws only the equipped weapon's `overlay` composition layers.
This keeps the expensive pose animation reusable by weapon type while allowing
each item to carry a small, frame-aligned visual patch.

Tag ids and order live in one content registry. Adding a tag is a registry
change, never coordinated numeric z-index edits. Unknown tags fail during
content load rather than disappearing silently.

Attachment slots are validated at load time too. A slot is semantic and
stable (`mainHand`, `head`, `back`); its anchor is spatial and may move per
frame. A weapon chooses a slot and defaults to `mainHand`, so changing which
hand owns that slot does not require changing every weapon definition.

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
- ordinary sprites still draw one baked canvas, while tagged composites draw one canvas per occupied band;
- equipment and weapon registries remain the only source of runtime loadout composition;
- no actor imports or depends on sprite authoring layer ids.

## First-release implementation

The first release follows the boundary above:

- `SpriteFile` is a flat-or-layered union with strict validation, shared timing, stable layer ids, required render tags, and character-grid compositing in `spritefile.ts`.
- `loadSprite` exposes both its compatible flattened canvas and lazily cached per-tag canvases. Flat text-grid and PNG-sheet assets expose their authored `renderTag`, or the generic `base` fallback outside tagged composites.
- The player render order comes from the `playerRenderTag` content registry. Body sprites and weapon visuals contribute only the bands declared in their own sprite/visual data; attachment anchors and hand choice are resolved independently.
- The Layers workspace owns the layer panel. It supports active-layer selection, tag assignment (including the implicit layer of a flat sprite), create, duplicate, rename, delete, within-tag reorder, hide, solo, lock, merge down, and undoable flatten. Menu → Edit layer tags manages the shared tag labels and back-to-front order. Deletion is dependency-driven: the manager lists every sprite layer, flat-sprite assignment, and registered visual that uses a tag and only blocks deletion while that list is non-empty. There are no renderer-reserved tag ids.
- Paint, soft brush, blur, fill, magic selection, clipboard, move, resize, and rotation operate on the active layer. The grid, onion skin, picker, and persistent preview use the visible composite.
- Frame add, duplicate, reorder, and delete update all layer tracks and anchor arrays as one history operation. Palette compaction scans and remaps every layer.
- The collaboration selection payload includes `layerId`, and scripted pixel edits may target a stable `layerId` explicitly.

The migration step remains deliberately separate: existing production sprites have not been split automatically. An artist can add the first layer to convert a flat document losslessly, then save the layered source when the split is intentional.
