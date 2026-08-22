# Sprite editor agent protocol

The sprite editor exposes a semantic, revisioned editing protocol while the
Vite development server is running. It is the preferred automation seam for
sprite work. Agents should describe *what* changes—copy this connected weapon,
remap these colors, set this anchor—instead of reproducing pointer gestures or
rewriting a complete JSON document.

The implementation is split deliberately:

- `tools/src/sprite-editor-agent.ts` is a DOM-free command engine. It owns
  validation, inspection, exact palette transfer, transforms, assertions, and
  atomic transactions.
- `tools/sprite-editor-bridge.ts` is the local HTTP and filesystem boundary. It
  owns paths, revisions, source-document loading, live publication, previews,
  and explicit saves.
- `tools/src/sprite-editor.ts` remains the human editor. It receives the same
  revisioned document and follows a command's animation/frame/layer cursor.
- `tools/sprite-agent.mjs` is a compact CLI client. It contains no art logic.

This boundary is intentional. New automation belongs in the pure command
engine and its capability manifest, not in a one-off script that mutates JSON
or drives canvas coordinates.

## Start and discover

```powershell
npm run dev -- --port 5174
$env:SPRITE_EDITOR_URL='http://127.0.0.1:5174'
npm run agent-sprite -- capabilities
npm run agent-sprite -- open equipment/rusty-sword.json
npm run agent-sprite -- inspect attack 3-5 sword
```

`GET /__sprite-editor/capabilities` is the machine-readable contract. It
reports the protocol version, frame indexing, limits, region and transform
forms, and the required/optional fields for every command. The API uses
zero-based frame indexes. The CLI's `inspect` range uses the one-based frame
numbers displayed by the editor.

### Persistent named selections

Reusable pixel masks belong in the bridge's named-selection library, not in an
agent's conversation state or a single transient `/selection` slot. The
library is stored in `tools/sprite-editor-selections.json` so a selection can
be applied after a server restart and by another collaborator.

```text
GET    /__sprite-editor/named-selections
GET    /__sprite-editor/named-selections/:name
PUT    /__sprite-editor/named-selections/:name
POST   /__sprite-editor/named-selections/:name/apply
DELETE /__sprite-editor/named-selections/:name
```

`GET /selection` and `GET /named-selections/:name` also return a computed
`geometry` object beside the raw selection. It includes pixel count, centroid,
and a deterministic principal axis (`start`, `end`, clockwise angle, length,
orthogonal RMS, and elongation). Use this instead of reparsing mask strings in
shell scripts. The axis is deliberately semantic-free: determine which end is
the grip from authoritative art or anchor data rather than assuming `start` is
always a grip.

`PUT` saves the current live selection when its body is empty, or accepts an
explicit `{ "selection": ... }` payload. `POST .../apply` accepts the target
`path`, animation, zero-based `frame`, `layerId`, and optional `x`/`y`; omitted
coordinates retain the saved mask's origin. Applying changes only the live
selection and publishes it to the editor. It never changes sprite pixels or
advances the document revision.

The bridge is development-only, loopback-only, same-origin checked, and
confined to `src/game/content/sprites/**/*.json`.

## Revision and transaction rules

1. Read `GET /__sprite-editor/state` immediately before editing.
2. Send its exact `revision` as `baseRevision` to
   `POST /__sprite-editor/commands`.
3. Put every coupled change and its assertions in one command array. The engine
   clones the active document, runs the batch, validates the entire result,
   then publishes it. Any error discards every command in the batch.
4. Use `dryRun: true` first for a transform or multi-frame operation. Add
   `inspect` queries for the frames you need to judge. Dry runs never advance
   the shared revision.
5. Fetch `preview.png` after the accepted revision and inspect the real editor
   composite. Numeric assertions prove structure, not visual alignment.
6. Saving is a separate decision. Commands update the shared draft; they never
   write the repository. Use the editor's **save all** or the explicit save
   endpoint only after human or visual approval.

A revision conflict is a stop signal. Re-read the live state and reconcile the
human's current edit; never retry by forcing an older full document over it.
Assertion-only or otherwise no-op transactions do not advance the revision or
invalidate an existing preview.

### Mandatory visual-calculation guard

Before calculating a visual transform, pause or step the editor to the target
frame and download `GET /__sprite-editor/preview.png`. Verify its
`X-Sprite-Revision` against the live state and inspect the PNG itself. Do not
reconstruct the rendered composite from JSON, anchors, bounds, or component
statistics while this endpoint is available. A human-supplied screenshot of
the current editor is also ground truth and must be considered alongside the
published preview.

Write down the requested measurement before doing arithmetic:

- **absolute angle** describes one axis;
- **rotation delta** is `targetAngle - sourceAngle`;
- in the editor's downward-positive canvas coordinates, a positive rotation
  is clockwise;
- rotation-only work keeps scale exactly `1`.

Identify source and target landmarks on the same rendered image and label them
before calculating. After one revision-safe mutation, retrieve and inspect the
new preview. If the post-edit PNG does not visually match, revert that
transaction before continuing. Never report success from endpoint math,
anchors, or a valid document without inspecting the rendered artifact for the
same revision.

### Non-mutating alignment comparison

Before publishing a difficult weapon transform, use the editor's **compose →
alignment comparison** panel. It turns the existing reference overlay into a
measured dry-run view:

- choose a reference sprite, animation, displayed frame, and individual source
  layer;
- independently isolate the target layer;
- switch among source-only, target-only, and ghosted overlay views;
- enter grip/tip (or other corresponding) source and target axes;
- inspect the derived uniform scale, clockwise rotation, and translation.

The comparison matrix is applied only while drawing. It never pastes or
resamples pixels into the active document, never changes the shared revision,
and therefore cannot damage the pristine source. **Export comparison PNG**
downloads the grid view. The editor also publishes the same artifact at
`GET /__sprite-editor/comparison.png`; the CLI command
`agent-sprite comparison <output.png>` retrieves it for agent-side visual
inspection. A comparison PNG is revision checked just like `preview.png`.

Browser automation may configure the view through
`window.__editor.comparison.configure(...)`. The source and target axes use
logical sprite-pixel coordinates and the source frame is the one-based number
shown in the editor (`0` follows the active frame). The returned state includes
the exact alignment matrix. This is a view API, not a second document mutation
path: accepted art still goes through an atomic command transaction.

## Inspection

`POST /__sprite-editor/inspect` returns document dimensions, animations and
resolved aliases, layers and render tags, anchor names, and requested frame
facts. Per-frame facts include:

- concrete animation and zero-based frame number;
- layer or composited pixel count and opaque bounds;
- exact RGBA colors, palette characters, and usage counts;
- optional connected components, sorted largest first, each with a stable
  opaque seed for a later `componentAt` region;
- effective anchors for that frame.

Set a query's `colors` or `components` to `false` when that evidence is not
needed. This keeps multi-frame command output small without weakening the edit
or its structural assertions.

Inspect the exact layer when copying a weapon or effect. Inspecting the
composite is useful for visual occupancy, but it cannot distinguish pixels
owned by the body, weapon, and slash layers.

## Command model

Commands currently cover the complete recurring workflow:

| Family | Operations |
| --- | --- |
| Structure | `layer.ensure`, `animation.materialize`, `frame.insert`, `frame.remove`, `frame.move` |
| Pixels | `frame.clear`, `frame.copy`, `frame.copyAligned`, `frame.remapColors`, `pixel.set` |
| Rig | `anchor.set` |
| Verification | `assert.frame`, `assert.anchor` |

Frame references are `{ animation, frame, layerId?, path? }`. An edit target
must be the active document; a `frame.copy` / `frame.copyAligned` source or
inspection may name another repository sprite with `path`. Layered edit targets require
`layerId`. Use `layerId: "*"` only with `frame.clear` to clear every layer in
one frame.

Regions are one of:

```jsonc
{ "rect": { "x": 4, "y": 8, "w": 20, "h": 12 } }
{ "componentAt": { "x": 9, "y": 11, "connectivity": 8 } }
{ "opaqueBounds": true }
```

`componentAt` is the safest way to isolate a detached sword, pommel, or effect
when inspection proves it is one component. A rectangle preserves transparent
space inside its bounds. `opaqueBounds` crops the frame to its overall opaque
bounds and therefore may include unrelated components.

Transforms accept clockwise `rotate` degrees and independent `scaleX` /
`scaleY`; negative scale mirrors. Scale, mirror, and rotation are performed in
one inverse-sampling pass from the untouched source. The extracted region's
center is the pivot. `to.x` and `to.y` place the **top-left of the transformed
output bounding box**, not its opaque bounds, grip, or pivot. Calculate scale
from the target/source axis-length ratio, rotation from their axis-angle
difference, then calculate translation separately.

For that recurring calculation, prefer `frame.copyAligned`. Give it two
control points in source-frame pixel coordinates and the two corresponding
points in destination-frame pixel coordinates:

```json
{
  "op": "frame.copyAligned",
  "from": {
    "path": "equipment/rusty-sword.json",
    "animation": "attack2",
    "frame": 0,
    "layerId": "sword"
  },
  "to": {
    "animation": "attack",
    "frame": 2,
    "layerId": "sword"
  },
  "region": { "componentAt": { "x": 74, "y": 56, "connectivity": 8 } },
  "sourceAxis": {
    "start": { "x": 72, "y": 63 },
    "end": { "x": 104, "y": 63 }
  },
  "targetAxis": {
    "start": { "x": 96, "y": 70 },
    "end": { "x": 117, "y": 92 }
  }
}
```

The operation derives one uniform scale (so pose-dependent sword length is
handled), clockwise rotation, and integer-grid placement. Both source points
must lie inside the extracted region. The result reports the derived transform,
ideal and raster placements, mapped endpoints, and endpoint error. It aborts
atomically when integer placement exceeds `maxEndpointError` (default 0.75px),
so a bounding-box origin can no longer be mistaken for the grip without being
visible in the command evidence. This proves the control-point alignment; the
real composite preview remains the final check for silhouettes, occlusion, and
incorrectly chosen points.

Colors are `#RRGGBB` or `#RRGGBBAA`; `null` is transparent. Cross-document
copy allocates exact destination palette entries by default. A full palette is
an error unless a transaction explicitly requests
`"paletteOverflow": "nearest"`. This prevents a quiet color downgrade.

## Productive frame workflow

The following transaction demonstrates the frame 3–5 pattern. It clears only
the intended overlays, always copies from an approved pristine source, applies
each frame's scale and rotation once, remaps an effect without changing its
shape, writes the weapon anchor, and inspects all results. API frame indexes
2–4 correspond to editor buttons 3–5.

```json
{
  "protocolVersion": 1,
  "dryRun": true,
  "commands": [
    {
      "op": "frame.clear",
      "target": { "animation": "attack", "frame": 2, "layerId": "sword" }
    },
    {
      "op": "frame.copy",
      "from": {
        "path": "equipment/rusty-sword.json",
        "animation": "attack2",
        "frame": 0,
        "layerId": "sword"
      },
      "to": {
        "animation": "attack",
        "frame": 2,
        "layerId": "sword",
        "x": 18,
        "y": 34
      },
      "region": { "componentAt": { "x": 24, "y": 49, "connectivity": 8 } },
      "transform": { "scaleX": 0.94, "scaleY": 0.94, "rotate": -17 }
    },
    {
      "op": "anchor.set",
      "anchor": "grip",
      "animation": "attack",
      "frame": 2,
      "point": { "x": 49.5, "y": 58, "angle": -17 }
    },
    {
      "op": "assert.anchor",
      "anchor": "grip",
      "animation": "attack",
      "frame": 2,
      "expected": { "x": 49.5, "y": 58, "angle": -17 }
    }
  ],
  "inspect": [
    { "animation": "attack", "frame": 2, "layerId": "sword", "components": true },
    { "animation": "attack", "frame": 3, "layerId": "sword", "components": true },
    { "animation": "attack", "frame": 4, "layerId": "sword", "components": true }
  ]
}
```

The numbers above illustrate the protocol; they are not universal art
coordinates. Derive each frame from inspection and the approved reference.
When apparent sword length changes with pose or perspective, use a per-frame
uniform scale before rotation. Never transform the previous frame's transformed
raster to make the next frame.

`tools/examples/rusty-sword-agent-frame3-5.json` is a repository-backed dry-run
fixture for this exact production document. It deliberately clears and
reconstructs displayed frames 3–5 only inside the transaction clone, proving
multi-layer clearing, pristine-source copy, one-pass rotation/scaling, anchor
updates, and structured inspection without changing the live revision.

Body and equipment anchors live in different sprite documents. Update the
body's hand anchor in a transaction while the body is active, then update the
weapon's `grip` while the equipment document is active. The preview proves the
two endpoints agree. An anchor is metadata describing accepted pixels; it is
not a substitute for aligning the pixels first.

## CLI

```text
agent-sprite list
agent-sprite capabilities
agent-sprite open <sprite.json> [--force]
agent-sprite state [--full]
agent-sprite inspect [animation] [display-frame|range] [layer-id]
agent-sprite run <transaction.json> [--dry-run] [--full]
agent-sprite preview <output.png>
agent-sprite comparison <output.png>
agent-sprite save [sprite.json]
```

`state` and `run` are compact by default to preserve agent context. `--full`
includes the complete sprite document or dry-run candidate when a downstream
tool genuinely needs it. Prefer inspection and command results over `--full`.

## Extension checklist

To add an operation without creating a parallel mutation path:

1. Add its discriminated command type and handler in
   `sprite-editor-agent.ts`.
2. Add it to `SPRITE_AGENT_OPERATIONS` and the capability reference; TypeScript
   requires every operation to be represented.
3. Reuse the DOM-free document operations for structural edits.
4. Return deterministic `changed` and compact `detail` evidence.
5. Add an atomic success/failure test and, when it affects visible state, a
   browser smoke test proving cursor synchronization and preview publication.
6. Keep filesystem access, revision checks, and live publication in the bridge.

Do not add a route per workflow, hard-code a sprite id, silently approximate
colors, save during a command, or use browser coordinates as the automation
contract.
