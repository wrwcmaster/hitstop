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

## 3. Normalize without destroying the pixels

Remove the background, isolate the character, and find the image's actual pixel-block scale. Then:

1. When reducing by a non-integer ratio, use coverage-aware pixel reduction:
   integrate the whole source footprint of each destination pixel instead of
   sampling one arbitrary point. Keep nearest-neighbor for integer pixel-grid
   scaling or as a diagnostic comparison.
2. Give the sprite a hard 0/255 alpha mask.
3. Place it on a fixed transparent canvas with a deliberate baseline and padding.
4. Quantize to a controlled palette.
5. Preserve semantic colors manually: eyes, emissive cores, team colors, hazard colors, skin highlights, metal highlights, and outlines should not be allowed to collapse into their nearest common color.

Never judge this step only from an enlarged image. Inspect the native 1× pixels too.

The workbench's **export normalized png** is the handoff artifact for animated
sources. It preserves hard transparency, shared frame size, per-frame offsets,
the approved baseline, and the selected palette. **to sprite json** indexes
those exact approved colors without performing another visual conversion.

## 4. Convert to versioned game-native data

Create a new prototype such as `knight-v2.json`; do not replace the playable asset yet. Most animated and composited art uses a `SpriteFile`. Tiles, icon atlases, and other registries should use their existing native content format rather than introducing a special case.

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
