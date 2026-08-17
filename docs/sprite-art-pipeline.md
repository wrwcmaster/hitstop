# Sprite art pipeline

The production loop is:

**brief → generate → normalize → game-native data → render → compare → pixel-polish → approve → expand**

This applies to every sprite: player characters, monsters, bosses, NPCs, armor, weapons, effects, props, tiles, pickups, and icons. The approval gates matter more than the tools. A technically valid asset is not finished art, and one weak representative frame becomes dozens of weak frames or variants if it is approved too late.

## 1. Lock the brief

Define these before generating anything:

- Asset role, viewing angle, representative state, and the context in which players see it.
- Visual reference and the features that must survive: silhouette, identity marks, material ramps, lighting direction, and gameplay readability.
- Proposed source grid, logical draw size, origin/baseline, collision box when applicable, attachment points, tile seams, and transparent overhang.
- Palette rules and outline color.
- Downstream variants: animation, damage states, equipment layers, directional versions, tile neighbors, or icon sizes.

Choose the simplest frame that proves the asset's design. A player starts unarmed and unarmored; a monster starts in its neutral pose; a weapon starts in its most readable held pose; a tile starts with the smallest set that proves its seams. Downstream variants should not be used to rescue a weak foundation.

## 2. Generate one visual source

Generate one representative frame or the smallest representative set first. Examples:

| Asset | First approval target |
| --- | --- |
| Player, NPC, or ordinary monster | Neutral idle pose |
| Boss | Neutral silhouette plus its signature telegraph if the idle does not express its scale |
| Weapon | Held pose or the key frame of its signature attack |
| Armor or wearable gear | Worn neutral overlay on the approved body |
| Effect | Peak-impact frame, then its anticipation and decay |
| Tile or modular prop | Center, exposed edge, inner corner, and outer corner |
| Pickup or UI icon | Final-size silhouette |

Use the approved image as an explicit identity/style reference and ask for:

- Only the requested asset or representative set, with generous padding or exact tile boundaries as appropriate.
- A game-ready view and a stable origin, baseline, attachment, or seam.
- A consistent square pixel grid, hard edges, deliberate clusters, and no antialiasing.
- A transparent background when the generator supports it. Otherwise choose a
  flat chroma-key color that is absent from the subject palette.
- No unrelated props, text, shadows, or unrequested variants.

Treat the chroma key as a reserved production color, not just a background
description. Name both the color and any intentional subject colors that must
survive. For example, the knight brief should include:

> Transparent background preferred. If transparency is unavailable, use solid
> #ff00ff only for the background. Do not use #ff00ff or near-magenta anywhere
> in the character. Preserve the knight's green eye light and teal cloth. Keep
> the face, eye cluster, hair silhouette, body proportions, palette, and light
> direction identical in every frame; animate only the explicitly requested
> breathing, cloth, and limb motion.

Do not use green as the key for a character with green eyes, poison, foliage,
or other green identity details. Change the key color instead of asking the
design to surrender a semantic color.

Keep the generated source. It is the comparison target, not yet a game asset.

For animation, the generated source must contain the complete candidate loop
before any frame is converted to JSON. Open that PNG in the sprite animation
workbench, remove its chroma key, detect/crop the frames, align them to one
origin and baseline, and review the loop at game scale. Switch between the
generated source and normalized-pixel views; the animation preview follows the
selected stage and has its own zoom/fit controls. Then approve all four image
gates:

1. generated source;
2. normalized identity and silhouette;
3. motion and cadence;
4. origin and baseline alignment.

Export the normalized PNG as the approved animation source. JSON conversion is
locked until those gates are checked. Do not manufacture animation by warping
or duplicating the converted JSON: that hides design decisions in a one-off
script, bypasses image approval, and does not scale to other characters.

When separately generated frames drift in colour, use **frame 0 reference**
for one exact shared palette. If a material still selects the wrong part of
that palette, enable **harmonize frame shading to frame 0**. The workbench uses
the first frame's vertical colour neighborhoods as a soft material cue; it
does not contain character-specific colour names. Leave it off for intentional
lighting changes or palette-swap animation.

Workspace-image review state lives entirely in the workbench URL. Refreshing
or sharing it restores the image, crops, offsets, normalization settings,
animations, and active view; approval checkboxes deliberately reset.

If a generated image still contains a legitimate color close to the chosen
key, enable **protect subject color** in generated-source view and drag one or
more tight regions over that detail; a click places a small mask using the
configured mask size. Protected regions bypass chroma removal
and spill suppression, carry key-adjacent subject colors through reduction,
reserve those semantic colors in the normalized palette, are visible as cyan
outlines, and are stored in the shareable URL. Keep them tight: key-colored
background inside a protected region is deliberately preserved too.

For a small identity feature that must not animate, place exactly one
corresponding protected region in every frame and enable **lock one protected
feature per frame to frame 0**. The workbench carries frame 0's approved target
pixel cluster into each region after reduction and before palette selection.
Use this for an iris, insignia, or fixed buckle—not for hair, cloth, limbs, or
anything whose shape is supposed to move.

### Use an approved frame as a consistency control

An identity reference plus a pose reference is not enough by itself. An image
model can follow the requested pose while quietly changing the character's
logical pixel resolution, head construction, hair clusters, scarf silhouette,
limb thickness, palette ramps, or outline language. A plausible new pose is
not necessarily the same character.

Use one isolated, approved frame as the master control. Do not use a full
animation sheet as the primary identity reference when a single frame is the
authority; the model may average details across the sheet.

Give every input exactly one role:

- **Master control:** identity, proportions, logical pixel size, palette,
  outlines, pixel clusters, material rendering, origin, and ground baseline.
- **Pose reference:** anatomy and limb arrangement only. It does not define
  character design, colors, rendering style, texture, or pixel grid.

Work in two stages.

#### Diagnostic: make style drift visible

First ask for a two-cell comparison image in one generation:

1. Cell A recreates the approved control pose.
2. Cell B shows the same character in the requested new pose.
3. Both cells use equal canvases, the same baseline, the same logical pixel
   grid, and the same palette.

Compare generated Cell A with the actual approved control, not merely with
Cell B. If Cell A drifts, reject the entire output even when the two generated
cells look internally consistent. Check at least:

- hair silhouette, bangs, face construction, eye, and iris;
- scarf outline and fold clusters;
- torso width, shoulders, limb thickness, and hands;
- leg spacing, boots, origin, and ground baseline;
- texel size, outline stair steps, palette ramps, and texture density.

The [idle/run consistency experiment](art/knight-v2-idle-run-consistency-test-01.png)
is the reference failure. Its two generated cells are coherent with each
other, but its generated idle cell changes the hair, scarf, arms, gloves,
torso, and leg spacing compared with the
[approved idle control](art/knight-v2-idle-frame-style-reference.png). That
means the run pose is not a valid extension of the approved character.

#### Production: keep the control literally unchanged

After the diagnostic makes the remaining drift obvious, build the production
comparison with the approved control copied byte-for-byte into Cell A. Generate
or edit only Cell B. Prefer a masked or region-limited edit; if that is not
available, generate Cell B separately and composite it beside the unchanged
control deterministically. Never ask the model to redraw the production
control cell.

Review the new pose beside that immutable control at source scale, normalized
scale, and in-game scale. Approve it only when it reads as motion applied to
the same approved character. Keep the paired control image with the candidate
until the new frame is approved; it is both a visual contract and a regression
reference.

## 3. Normalize without destroying the pixels

Remove the background, isolate the character, and find the image's actual pixel-block scale. Then:

1. When reducing by a non-integer ratio, use coverage-aware pixel reduction:
   integrate the whole source footprint of each destination pixel instead of
   sampling one arbitrary point. A generated pseudo-pixel image does not
   necessarily contain one recoverable lattice—block size and phase can vary
   by feature—so do not infer cell boundaries unless the source was authored on
   a guaranteed grid. Keep nearest-neighbor as a diagnostic comparison.
2. Give the sprite a hard 0/255 alpha mask.
3. Place it on a fixed transparent canvas with a deliberate baseline and padding.
4. Quantize to a controlled palette.
5. Weight palette samples by local edge contrast, so small bounded features can
   compete with broad clothing colors without rules for particular hues or
   brightness ranges. Use manual protection only when a real subject color is
   close enough to the chroma key to be removed before segmentation.

Never judge this step only from an enlarged image. Inspect the native 1× pixels too.

The workbench's **export normalized png** is the handoff artifact for animated
sources. It preserves hard transparency, shared frame size, per-frame offsets,
the approved baseline, and the selected palette. **to sprite json** indexes
those exact approved colors without performing another visual conversion.

## 4. Convert to versioned game-native data

Create a versioned prototype before replacing a playable asset. Knight V2 followed this gate and is now the canonical player body; future redesigns should use a fresh name until their identity, animation, equipment, and gameplay checks pass. Most animated and composited art uses a `SpriteFile`. Tiles, icon atlases, and other registries should use their existing native content format rather than introducing a special case.

A `SpriteFile` prototype contains:

- The approved normalized pixels at their authored density. A 4x-density
  source is exported as `hd: false`; conversion must not downsample it and ask
  the runtime to reconstruct the clusters with EPX.
- `hd`, physical `w`/`h`, and the proposed `hitbox`.
- The approved indexed frame set and its shared palette.
- Relevant anchors such as hands, head, muzzle, effect origin, or equipment attachment.

At this point the smallest representative set is enough. Animation, equipment variants, damage states, tile families, and alternate sizes come after visual approval.

## 5. Render through the real sprite editor

Run the development server and open the prototype through the collaboration bridge:

```powershell
npm run dev -- --port 5174
$env:SPRITE_EDITOR_URL='http://127.0.0.1:5174'
npm run agent-sprite -- open knight-v2.json
npm run agent-sprite -- preview knight-v2-preview.png
```

The editor render is the source of truth. Inspect three views:

| View | What it catches |
| --- | --- |
| Original generated source | Lost identity, pose, or material detail |
| Editor grid | Broken clusters, stray key color, and individual feature pixels |
| Editor/game-scale preview | Features that disappear, merge, or become visually noisy at play size |

Compare silhouette, proportions, material ramps, origin/seams, attachment points, transparent fringe, and the feature that communicates gameplay. For characters, zoom into the eyes and hands. For weapons, inspect the grip and active edge. For effects, inspect the focal point and contrast. For tiles, repeat the pattern and test every neighbor seam. For icons, judge at final UI size.

## 6. Pixel-polish with small controlled variants

Change one feature at a time through the shared revision, render again, and compare it to the source. When a choice is uncertain, render two or three tiny variants rather than guessing.

The `knight-v2` eye is one reference example: automatic conversion retained the dark iris but collapsed the white sclera, making the eye read as a black mark. Three variants were rendered in the editor. The accepted version uses one white sclera column, one dark iris column, a teal lower-iris pixel, and a continuous upper lash. The wider version looked correct while zoomed but became a white rectangle at game scale. Apply the same method to a sword tip, boss eye, spell core, tile corner, or any other feature whose meaning depends on a few pixels.

Do not silently replace a dirty shared document. Read its revision, merge only the intended pixels, and leave repository saving explicit until the human accepts the result.

### Patch an embedded weapon one frame at a time

An attack frame may already contain a generic weapon and slash effect while an
equipment sprite supplies item-specific art. Treat the equipment art as a
small, layered patch over the approved body frame. Do not regenerate or
re-normalize the complete character merely to change the weapon.

Use this order for each frame:

1. Open the body and equipment sprites on the same animation and frame number.
2. Clear only the target equipment frame's `Sword` and `Slash` layers. Confirm
   that no stale overlay remains before copying anything.
3. Copy the pristine normalized weapon from its approved source frame. Always
   restart from this untouched source; rotating an already transformed copy a
   second time compounds rasterization damage and softens the pixel clusters.
4. Measure the source and target weapon axes from two visible points, normally
   grip center to blade tip. Their angle difference gives the rotation; their
   length ratio gives the per-frame scale, since perspective and pose may make
   the apparent sword length change. Derive both first and apply scale plus
   rotation to the untouched source in one resampling pass, then translate the
   result into place. Prefer uniform scaling unless the approved reference
   clearly requires a width change. Scale, rotation, and translation are
   separate visual checks even when scale and rotation share one raster pass.
5. Align the rendered weapon to the embedded reference in the live composite.
   The opaque-pixel bounding box is not the transform box: transparent pixels,
   the selection rectangle, and its pivot all affect placement. Use the live
   selection bounds and transform state, not an inferred five-pixel component
   box or stale serialized coordinates.
6. After the art is visually correct, update both attachment endpoints for the
   frame: the body's hand anchor and the weapon's grip anchor. Anchors describe
   the accepted placement; they must not be used to justify a visibly wrong
   placement when the existing anchor metadata is itself inaccurate.
7. Add small detached weapon details, such as a pommel cap, as part of the
   weapon overlay and verify them against the live frame. Preserve the full
   selection rectangle and pivot when moving these details, even if only a few
   pixels inside that rectangle are opaque.
8. Put the slash effect on its own `Slash` overlay. Extract the exact connected
   effect shape from the approved body frame, excluding the embedded blade,
   then transfer the material colors from an already approved slash frame.
   Preserve the source shape and alpha structure; color matching must not
   redraw its silhouette.
9. Inspect the editor grid and the body-plus-equipment preview on the same
   frame. Save only after the overlay covers the embedded reference, the grip
   is stable, the detached details are aligned, and no original effect color
   leaks around the patch.

The editor's live document is authoritative during this workflow. Before an
agent edit, require a synced bridge revision. If the editor reports a conflict,
stop: do not calculate from or write through the stale bridge state. Reconcile
the live browser edit first, especially after a human has manually corrected a
transform. Make one deterministic change, render it, and visually verify it
before reporting success. A JSON-valid result or a mathematically aligned
anchor is not evidence that the pixels are aligned.

For repeatable frames, encode the clear/copy/one-pass transform/color
remap/anchor/assert sequence as one semantic transaction and dry-run it before
publication. The command and coordinate contract is documented in
[Sprite editor agent protocol](sprite-editor-agent.md); it includes a frames
3–5 example and deliberately keeps repository saving outside the transaction.

## 7. Approval gates

Advance only when the previous applicable gate is accepted:

1. **Foundation gate:** the representative frame or minimal set reads correctly at grid and final display scale.
2. **Expansion gate:** animation frames, directions, damage states, tile neighbors, or size variants preserve that design.
3. **Attachment gate:** gear, weapons, anchors, emitters, and modular seams remain aligned.
4. **Context gate:** composites and repeated tiles work against real characters, rooms, backgrounds, and UI.
5. **Gameplay gate:** collision, telegraphs, team/hazard readability, mobile scale, and co-op rendering remain clear.

For the player, these become identity → motion → equipment → weapon → gameplay. Only after the identity gate should the idle frame become a breathing animation; run and airborne poses inherit that approved body, and equipment inherits the approved animation grid. Other sprite types follow the same dependency rule with their own representative frame.

## 8. Integrate and verify

Once every gate passes:

- Promote the prototype through its existing content registry.
- Align dependent sheets, anchors, origins, and tile seams to the approved foundation.
- Revisit collision only when the gameplay silhouette requires it; transparent visual overhang need not enlarge a physical body.
- Keep the normalized reference PNG under `docs/art/` beside the JSON's design history.
- Run typecheck, production build, `build:single`, deterministic replays, and real gameplay screenshots.

## Failure modes to avoid

- Generating the full animation, equipment, effect, or tile family before approving its representative frame/set.
- Treating a large canvas as detail while filling it with coarse rectangles.
- Trusting palette quantization on eyes, mouths, fingers, weapon edges, spell cores, hazard colors, or tiny highlights.
- Comparing only the editor grid and not the actual game-scale preview.
- Resampling with smoothing or using inconsistent pixel-block sizes.
- Letting gear sit on the body like stickers, effects lose their focal point, or tiles reveal their repetition and seams.
- Replacing a dirty shared editor revision or saving browser work without explicit acceptance.
