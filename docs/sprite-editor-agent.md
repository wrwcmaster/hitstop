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
zero-based frame indexes. The CLI's `inspect` range and `preview --frame` use
the one-based frame numbers displayed by the editor.

### Frame-addressed previews

The last automatically published preview remains available at
`GET /__sprite-editor/preview.png`. To verify a specific frame without moving
the human's cursor, request both its animation and zero-based frame:

```text
GET /__sprite-editor/preview.png?animation=run&frame=4
npm run agent-sprite -- preview frame-5.png --animation run --frame 5
```

The bridge asks the connected editor to render that exact composite, returns
the PNG with revision/animation/frame response headers, and restores the
visible animation, frame, play state, and preview bitmap before replying. The
request is read-only: it does not advance the document revision or change the
editor cursor. Use this route for multi-frame verification; never assume the
unqualified `preview.png` happens to contain the frame being measured.

### Anchor-centered focused previews

When a full composite is too small to judge weapon overlap, request a fixed
square crop centered on a named anchor rendered by the selected body:

```text
GET /__sprite-editor/preview-focus.png?animation=sword-run&frame=3&anchor=frontHand&zoom=300&size=384
npm run agent-sprite -- preview-focus frame-4-close-up.png --animation sword-run --frame 4 --anchor frontHand --zoom 300
```

`frame` is zero-based over HTTP and one-based in the CLI. `zoom` is an integer
percentage from 100 through 800; `size` is the output width and height in
pixels (384 by default, 128 through 1024). The renderer first produces the
same addressed composite as `preview.png`, then scales it with nearest-neighbor
sampling and places the named anchor at the exact center of the returned PNG.
It does not change the editor's zoom, cursor, playback state, or document
revision. Response headers include `X-Sprite-View: focused-composite-preview`,
`X-Sprite-Center-Anchor`, and `X-Sprite-Zoom`.

For every body/equipment alignment or detached-detail pass, the focused preview
is a mandatory verification gate. Request it from the accepted revision at an
explicit zoom of at least 250% (300% by default), centered on the relevant
rendered attachment anchor. Inspect the returned PNG directly and check the
entire weapon silhouette: guard, both blade edges, tip, handle, pommel, and any
exposed pixels from the reference art. A full-size `preview.png`, the alignment
comparison alone, or a numerically successful transaction cannot substitute
for this close-up.

Use `canvas.png` in addition when the anchor marker itself, a selection, or
another authoring overlay must be visible. The focused preview centers on an
anchor that is actually rendered for the requested frame; an unknown or
unrendered anchor is an error rather than a fallback to a guessed position. If
`preview-focus.png` errors, times out, returns the wrong frame/revision, or
cannot resolve the requested attachment anchor, stop and mark the artwork
unverified. Fix the endpoint or its semantic anchor mapping before adjusting
pixels or reporting completion. Never silently fall back to the ordinary
preview because the focused route failed.

### Frame-addressed editable canvas

Use the canvas endpoint when the evidence must include authoring overlays such
as the selected anchor, selection boundary, grid, onion skin, or alignment
comparison—not merely the game-scale composite preview:

```text
GET /__sprite-editor/canvas.png?animation=run&frame=4
npm run agent-sprite -- canvas frame-5-canvas.png --animation run --frame 5
```

Append `anchorLabels=0` when the selected anchor's text obscures the artwork
being judged. This hides only the label in the returned read-only artifact; the
crosshair, ring, and authoritative white center dot remain visible, and the
human's canvas is restored unchanged.

The returned PNG is the sprite editor's actual `#grid` rendering at the current
editor zoom. The request temporarily renders the addressed zero-based frame,
then restores the human's animation, frame, selection, and visible canvas
before replying. Response headers identify the sprite revision, animation,
frame, and `X-Sprite-View: editable-canvas`. Use this endpoint instead of
cropping a browser screenshot when inspecting anchors or selections.

Anchor overlays use a thin black-outlined cyan crosshair and compact ring. The
small **white center dot** is the authoritative anchor coordinate. Do not infer the point
from the cyan label, the ends of the crosshair, a nearby gold crossguard, or
the apparent center of overlapping artwork. When the center dot is obscured or
ambiguous even in `canvas.png`, report that ambiguity and request a clearer
zoom or human direction instead of proposing a movement.

#### Adjust an anchor from a visual reference

Anchor matching is a landmark task, not a coordinate-copy task. Two animation
frames have different poses, so the correct anchor generally does not occupy
the same local `x`/`y` coordinate or the same screen position in both frames.
Match the anchor's relationship to the artwork instead.

Use this feedback loop:

1. Fetch `canvas.png` for the approved reference frame and the target frame at
   the same editor zoom and revision. Inspect both images directly.
2. On the reference, name the exact local landmark before proposing a move.
   For `knight-v2` sword-run's `frontHand`, the approved frame-1 convention
   combines two independent constraints: the hand-side edge of the cross-guard
   determines the position **along** the sword, and the midpoint between the
   blade's two visible edges determines the position **across** the sword.
   "Near the sword", "guard center", and "blade center" are not
   interchangeable landmarks. Do not generalize this content-specific
   convention to another anchor without an approved reference.
3. On the target, locate that same semantic landmark from the target pose. The
   white center dot is the current anchor; it is not evidence of where the
   target landmark ought to be.
4. Visually infer the full two-dimensional correction from the white dot to
   the chosen landmark. Check both axes. Projecting only a blade centerline can
   miss the cross-guard constraint and incorrectly produce zero horizontal
   movement.
5. State the proposed change as both a delta and an endpoint, for example
   `(-1, -2.125): (18.5, 17.875) -> (17.5, 15.75)`. In canvas coordinates,
   left/up are negative and right/down are positive.
6. If converting a displacement seen in the rendered PNG, use a verified
   canvas-to-sprite scale. Do not infer it from the checkerboard size, PNG
   dimensions, device-pixel ratio, or a remembered zoom. Those may not describe
   the logical sprite-coordinate transform. A visually precise landmark with
   an unverified scale is still an unverified coordinate.
7. Apply one move, then fetch fresh `canvas.png` images for **both** the
   reference frame and target frame at the accepted revision. Inspect them
   together. A remembered reference or a target-only screenshot is not a
   feedback loop.
8. Re-establish the target landmark from the post-move art rather than checking
   whether the dot reached the coordinate predicted before the move. For a
   blade centerline, choose two well-separated positions on the unobscured
   blade, find the visual midpoint between the two blade edges at each
   position, connect those midpoints into the blade's **longitudinal axis**,
   and extend that axis back to the cross-guard. Do not estimate the centerline
   from the guard-area silhouette: the guard, hand, perspective, and label can
   obscure or widen it. Do not use one edge, the guard center, a single local
   midpoint, or the previously chosen screen X/Y as the sword axis.
9. Do not declare success from the requested coordinate, bridge response,
   arithmetic, or arrival at the agent's own estimate. Approval requires the
   fresh paired canvases to show the same named dot-to-art relationship. If the
   relationship remains ambiguous, report it as unverified.

For a human-guided step-by-step adjustment, do not mutate while describing the
next move. Show the exact canvas artifact the agent inspected, propose one
specific delta, and wait for approval. If the human supplies the correct
coordinate, treat it as authoritative: calculate and record the residual error,
invalidate the rejected landmark/scale assumption, and do not reuse it on later
frames. Automated pixel statistics may support diagnosis, but visual inference
from the editable canvas is the approval criterion for anchor placement.

Before reporting an anchor as correct, state all four checks explicitly:

- the white center dot—not its label—is the point being judged;
- the along-axis landmark matches the approved reference;
- the across-axis/centerline landmark lies on the longitudinal axis derived
  from two separated blade midpoints and matches the approved reference; and
- the reference and target canvases are fresh artifacts from the same accepted
  revision.

If any check cannot be stated from direct visual evidence, the result is not
verified. Never use the fact that a semantic command successfully wrote the
requested coordinate as evidence for any of these visual checks.

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
   composite. For body/equipment overlap, also fetch and directly inspect
   `preview-focus.png` at 250% or greater, centered on the relevant attachment
   anchor. Both artifacts must address the edited frame and accepted revision.
   Numeric assertions prove structure, not visual alignment. A failed focused
   preview leaves the edit unverified and blocks completion.
6. Saving is a separate decision. Commands update the shared draft; they never
   write the repository. Use the editor's **save all** or the explicit save
   endpoint only after human or visual approval.

A revision conflict is a stop signal. Re-read the live state and reconcile the
human's current edit; never retry by forcing an older full document over it.
Assertion-only or otherwise no-op transactions do not advance the revision or
invalidate an existing preview.

### Mandatory visual-calculation guard

Before calculating a visual transform, download the frame-addressed preview
for the target animation and frame. Verify its
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

Choose the least powerful operation that explains the visible error. A
constant one-pixel displacement of the complete silhouette is a rigid
translation, not a new two-endpoint alignment problem. Apply the translation
with rotation and scale unchanged. Do not move one axis endpoint while holding
the other fixed: that changes axis length and therefore introduces scaling.
Explicitly state whether “one pixel” means one logical sprite pixel or one HD
texel (the authored sheets use 4x texel density), then fetch a new focused
preview after that single move. Only escalate to rotation, scaling, or a full
pristine-source refit when the new render demonstrates that translation alone
cannot solve the mismatch.

Do not conceal a geometry error with invented pixels. In particular, an
exposed cross-guard must first be treated as evidence that the approved weapon
art is misplaced. Move or refit that approved art; do not extend the guard with
an improvised color pattern. Constrained pixel cleanup comes only after the
transform is accepted and must preserve the approved silhouette and material
ramp.

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

The comparison is valid only when its reference names the body animation and
displayed frame that correspond to the equipment animation and frame being
edited. Never accept the panel's previous selection, active-frame fallback, or
an animation with a similar name without checking the resolved animation and
frame reported by the comparison state. If the equipment animation is a
weapon-profile animation, resolve its body-profile mapping first. When no
mapping exists, stop and ask which body pose is authoritative.

Before judging silhouette overlap, align the reference attachment anchor with
the equipment grip anchor in the comparison view. This anchor alignment is a
view transform only; it must not mutate either anchor. A ghosted overlay made
from unmatched anchors, the wrong body frame, or the wrong animation can look
plausible while recommending the wrong translation. Record the resolved source
animation/frame, target animation/frame, and both anchor coordinates alongside
the exported comparison artifact.

The comparison matrix is applied only while drawing. It never pastes or
resamples pixels into the active document, never changes the shared revision,
and therefore cannot damage the pristine source. **Export comparison PNG**
downloads the grid view. The editor also publishes the same artifact at
`GET /__sprite-editor/comparison.png`; the CLI command
`agent-sprite comparison <output.png>` retrieves it for agent-side visual
inspection. A comparison PNG is revision checked just like `preview.png`.

For an agent request, do not depend on a comparison that the human happened to
configure earlier. Request the target frame, body reference, and layers
explicitly; the editor resolves the body-profile animation/frame, aligns the
compatible attachment anchors, renders the comparison, and restores the
human's view without changing the document revision:

```text
GET /__sprite-editor/comparison.png?animation=run&frame=3&reference=knight-v2.json&sourceAnimation=&sourceFrame=0&sourceLayer=base&targetLayer=base&view=overlay&opacity=50
npm run agent-sprite -- comparison frame-4-comparison.png --animation run --frame 4 --reference knight-v2.json --source-layer base --target-layer base
```

The HTTP frame is zero-based; the CLI frame is one-based. `sourceFrame=0`
uses the mapped target frame, and an empty `sourceAnimation` uses the equipped
weapon's body-animation profile (for example `run` → `sword-run`). The
frame-addressed endpoint fails instead of exporting an origin-aligned image
when the reference and target do not expose compatible attachment anchors.

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
| Pixels | `frame.clear`, `frame.copy`, `frame.copyAligned`, `frame.projectAligned`, `frame.translate`, `frame.remapColors`, `pixel.set` |
| Rig | `anchor.set` |
| Verification | `assert.frame`, `assert.anchor` |

Frame references are `{ animation, frame, layerId?, path? }`. An edit target
must be the active document; a `frame.copy` / `frame.copyAligned` /
`frame.projectAligned` source or
inspection may name another repository sprite with `path`. Layered edit targets require
`layerId`. Use `layerId: "*"` only with `frame.clear` to clear every layer in
one frame.

Regions are one of:

```jsonc
{ "rect": { "x": 4, "y": 8, "w": 20, "h": 12 } }
{ "componentAt": { "x": 9, "y": 11, "connectivity": 8 } }
{ "mask": { "x": 4, "y": 8, "rows": [".111.", "11111", ".111."] } }
{ "opaqueBounds": true }
```

`componentAt` is the safest way to isolate a detached sword, pommel, or effect
when inspection proves it is one component. A rectangle preserves transparent
space inside its bounds. `opaqueBounds` crops the frame to its overall opaque
bounds and therefore may include unrelated components.
`mask` carries an exact arbitrary pixel selection, including a mask produced by
SAM or loaded from the named-selection API. Its rows contain only `1` (selected)
and `.` (unselected), and its `x`/`y` are source-frame pixel coordinates.

Transforms accept clockwise `rotate` degrees and independent `scaleX` /
`scaleY`; negative scale mirrors. Scale, mirror, and rotation are performed in
one inverse-sampling pass from the untouched source. The extracted region's
center is the pivot. `to.x` and `to.y` place the **top-left of the transformed
output bounding box**, not its opaque bounds, grip, or pivot. Calculate scale
from the target/source axis-length ratio, rotation from their axis-angle
difference, then calculate translation separately.

Use `frame.translate` when an approved frame is correct internally but its
whole pose is offset on the shared canvas. It translates every layer by an
integer pixel-grid `dx` / `dy`, moves all frame anchors by the corresponding
logical distance, performs no resampling, and aborts instead of clipping.

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
handled), clockwise rotation, and grid placement. Both source points must lie
inside the extracted region. A fractional ideal placement is preserved as an
inverse-sampling phase instead of being rounded away, preserving the requested
control-point geometry during rasterization. This does not authorize a
fractional composite draw origin: sprite-backed attachments are separately
snapped to the body sprite's authored-pixel lattice by the renderer. The result reports the derived transform,
ideal and raster placements, `samplingPhase`, mapped endpoints, and endpoint
error. It aborts atomically when endpoint error exceeds `maxEndpointError`
(default 0.000001px), so a bounding-box origin can no longer be mistaken for
the grip without being visible in the command evidence. This proves the
control-point alignment; the real composite preview remains the final check
for silhouettes, occlusion, and incorrectly chosen points.

When the target frame already has an approved silhouette but needs material
detail from a pristine source, use `frame.projectAligned` with the same two
axes. It samples the once-transformed source texture only into pixels that are
already opaque in the target layer. Pixels just outside the transformed source
raster use the nearest transformed source sample, while target-transparent
pixels remain transparent. The result reports direct and nearest-sample counts;
the target pixel count, bounds, and anchors must remain unchanged. This is the
preferred operation for recoloring a frame-aligned weapon patch without
replacing its pose-specific geometry.

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
agent-sprite preview <output.png> [--animation <name> --frame <display-frame>]
agent-sprite canvas <output.png> --animation <name> --frame <display-frame>
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
