# Refactor review

This is an early-stage game. The cleanup removes obsolete paths rather than adding save migrations or retaining retired editor formats.

## Responsibility boundaries

- Door landing is geometry over explicitly supplied rooms, body dimensions and collision. Door transition sequencing takes movement/swap/stop callbacks; `PlayScene` keeps run and room lifetime. Door rendering consumes presentation inputs.
- Scenario reference validation runs before a new scenario changes the scene stack or world.
- Portal destinations retain authored arrival coordinates. A room's portal pad takes precedence when present; padless destinations use the catalog coordinates. Omitted coordinates retain the ordinary room-arrival defaults.
- Main's newer sprite editor architecture is preserved: shared flat/layered document validation, semantic agent commands, workspace validation, and transactional edits that include selection state. This branch's older document/history/preview extraction was superseded and removed during integration, not layered over the newer implementation.
- No runtime dependencies or engine-to-game imports were introduced.

## Removed paths

- Unknown room IDs silently loading the arena; unknown scenario references silently disappearing.
- Invented player dimensions in door/portal placement; optional defaults for always-initialized transition state; unused transition source-room state.
- A stale generated gatehouse doorway.

Editor import formats and preview behavior remain as implemented on main. The earlier branch's editor fallback removals are not part of the integrated PR.

Defaults for genuinely optional save fields, missing gamepads, no selected composite weapon, authored animation aliases, empty optional content lists, and safe collision placement remain. They serve current workflows, not compatibility with a retired format.

## Integration

Merged main at `d4c134d` into the refactor branch. Kept the newer editor and its documentation, removed the duplicate npm script key, and rebuilt the conflicted single-file artifact from the merged source. No sprite art or replay fixtures were rewritten by this resolution.

## Verification on the merged source

- Typecheck and game/editor production builds pass; `hitstop.html` rebuilt.
- `test:doors`: both arrival directions, actual body sizes, blocked/unpaired destinations, transition ordering, opacity, opening delay and walk cap.
- `test:refactor`: invalid scenario rejection without world changes, portal catalog/arrival contracts, keyboard/touch/gamepad labels.
- `test:sprite-editor`: main's document/semantic-command model suite passes.
- `test:sprite-editor:ui`: main's browser smoke suite passes, including layered document editing and agent transactions.
- Replay suite: 12 pass and 19 fail on both the merged source and an untouched checkout of main at `d4c134d`. Reports match exactly after removing timing measurements, including first-divergence hashes and RNG draw counts. These fixtures were not refreshed to hide the failures.
- Browser door sweep: all executable cases pass (47 enumerated; existing traversal gates unchanged).
- Semantic bug tapes: four pass; `mountain-door-landing` fails with an extra return crossing and ends at y=105 in `mountain_passage` instead of y=14 in `mountain`. The untouched main server reproduces that same failure. Expectations were not weakened.

The previously identified expiring warden-key issue and cosmetic/gameplay RNG coupling were not changed by this structural refactor.

## Portal review follow-up

Restored the registry's optional `x/y` and all five authored arrivals. The regression test failed against the pad-only implementation before the fix, then passed after it. It covers the padless menu callback as well as pad precedence. A browser run selected both a registered padless gatehouse destination (120, 460) and the existing grotto pad (115.75, 64) through the portal menu and completed both transitions without page errors. Typecheck, focused contract tests, and the single-file build pass; the 19 known replay failures remain.
