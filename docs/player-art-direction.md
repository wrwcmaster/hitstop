# Player art direction

The player should read as a capable, weathered adventurer before any equipment is added. Equipment changes the silhouette and material language without replacing the character underneath. This is the production contract for keeping body, armor, weapons, physics, and editor previews aligned.

## Native scale

- Player and worn-gear sheets are **48×80 source pixels** with `hd: false`: four source pixels equal one logical game pixel.
- They draw at **12×20 logical pixels**.
- The current collision box is `{ x: 1, y: 2, w: 10, h: 18 }`. Hair, scarf, shoulders, and attack poses may use the transparent overhang without changing collision.
- Feet stay on source row 79. Every frame uses the same canvas and origin.
- Weapon sheets remain **128×128 source pixels** with the player origin at logical `{ x: 16, y: 16 }`, leaving room for large swing silhouettes.

`knight-v2.json` is an intentionally separate identity prototype at **64×112 source pixels / 16×28 logical pixels** with a proposed `{ x: 3, y: 4, w: 10, h: 24 }` hitbox. It does not replace this playable contract until its idle, motion, equipment, weapon, and gameplay gates are approved.

## Visual language

- Dark blue-purple colored outlines, never pure black.
- Upper-left lighting with clustered shadows and isolated one-pixel highlights.
- Warm skin and hair against cool teal cloth and desaturated steel.
- No antialiasing, gradients, blurred pixels, or partially transparent body pixels.
- The base body is complete and attractive without equipment. Armor is a true overlay, not a recolor.
- Favor a readable head, hands, scarf, and boots over tiny buckles or seams that disappear at game scale.

## Animation contract

| Animation | Frames | Purpose |
| --- | ---: | --- |
| `idle` | 4 | Breathing and scarf movement without sliding the feet |
| `run` | 8 | Full opposing arm/leg gait with a two-beat body bob |
| `air` | 1 | Neutral apex pose |
| `rise` | 2, non-looping | Compressed upward silhouette |
| `fall` | 2, non-looping | Open descending silhouette |

The renderer falls back to `air` when an older sheet has no `rise` or `fall`, so optional actor sheets remain valid. Gear layers carry the same animation names and frame counts as the body.

## Anchors

`SpriteFile.anchors` stores named, frame-aligned points in logical pixels from the sprite's top-left. The knight currently authors:

- `frontHand` — the knight's right hand and primary weapon grip. In the authored right-facing three-quarter view, this is the hand on the **left** side of the image.
- `rearHand` — the knight's left hand, used as the bow-string hand and for future two-handed poses. In the authored right-facing view, this is the hand on the **right** side of the image.
- `head` — helmet/accessory reference.

Anchors follow animation aliases, mirror with facing, and travel through the body squash/shear transform. In the sprite editor, select an anchor and Alt-click the grid to place it. Adding, duplicating, deleting, renaming, or nudging frames keeps anchor arrays aligned.

## Equipment composition

The render order is:

1. Base player body.
2. Equipped armor layers, ordered by their registered `order`.
3. Held weapon.
4. Foreground grip pixels, colored by the highest equipped gear layer that supplies a `grip` style.
5. Trails, hit effects, and other action effects.

Gear visuals are registered by **item id**, not by slot. A visual declares its `slot`, so `iron-helmet` is drawn only when that exact item occupies `helmet`; a future second helmet can have different art and icon without player-render changes. The idle gear frame is trimmed automatically into its inventory icon.

Sprite-backed blades carry idle/run/air and attack-aligned art. Ranged weapons use the body anchors directly: the bow's full draw reaches from `frontHand` to `rearHand`, and projectile muzzle offsets remain weapon-type data.

## Authoring loop

Use the full [sprite art pipeline](sprite-art-pipeline.md): generate and approve one versioned idle prototype before producing animation or equipment. Render every revision in the editor, compare it with the original visual source at native and game scale, and pixel-polish identity features before advancing.

After the identity gate:

1. Open the approved body or equipment file in the sprite editor.
2. The full-player composite re-bakes unsaved body, armor, helmet, and sprite-weapon changes immediately.
3. Inspect `GET /__sprite-editor/preview.png` or use `npm run agent-sprite -- preview <file>` for an agent-visible render.
4. Check idle, run, air, armor, and every weapon at game scale.
5. Use **save to repo** only after the shared revision is accepted.

The committed first set is the visual baseline, not a frozen costume. Future art should preserve this grid, origin, anchor vocabulary, and palette discipline unless a deliberate whole-player scale pass changes the contract.
