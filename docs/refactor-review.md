# Refactor review

This is an early-stage game. The cleanup removes obsolete paths rather than adding save migrations or retaining retired editor formats.

## Responsibility boundaries

- Door landing is geometry over explicitly supplied rooms, body dimensions and collision. Door transition sequencing takes movement/swap/stop callbacks; `PlayScene` keeps run and room lifetime. Door rendering consumes presentation inputs.
- Scenario reference validation runs before a new scenario changes the scene stack or world.
- Portal destinations contain menu metadata; the room's portal trigger is the only arrival geometry.
- The sprite editor composes document validation, bounded history, and a game-renderer preview adapter. History has no DOM or renderer dependencies; preview options have no DOM dependencies.
- No runtime dependencies or engine-to-game imports were introduced.

## Removed paths

- Unknown room IDs silently loading the arena; unknown scenario references silently disappearing.
- Invented player dimensions in door/portal placement; optional defaults for always-initialized transition state; unused transition source-room state.
- Duplicate portal coordinates and a stale generated gatehouse doorway.
- Retired flat-frame sprite import conversion; editor palette/frame/FPS/checkbox defaults where the document or page already guarantees their presence.
- Duplicated undo/redo restoration; silent weapon/trail rendering failures. Preview errors now appear in the preview itself.

Defaults for genuinely optional save fields, missing gamepads, no selected composite weapon, authored animation aliases, empty optional content lists, and safe collision placement remain. They serve current workflows, not compatibility with a retired format.

## Verification

- Typecheck and game/editor production builds pass; `hitstop.html` rebuilt.
- `test:doors`: both arrival directions, actual body sizes, blocked/unpaired destinations, transition ordering, opacity, opening delay and walk cap.
- `test:refactor`: invalid scenario rejection without world changes, portal catalog/arrival contracts, keyboard/touch/gamepad labels.
- `test:sprite-document`: all 14 repository sprite files, aliases, malformed frames, obsolete-format rejection, snapshot isolation, undo/redo branching and capacity.
- `test:sprite-editor`: browser import/undo/redo, unchanged history after invalid import, live weapon rebake, three composite bodies and visible preview errors.
- All 31 deterministic replay fixtures match without re-recording.
- Browser door sweep passes its executable cases (47 enumerated; existing traversal-gated cases unchanged). A separately driven gatehouse/Old Mill Road round trip also passes.
- Semantic bug tapes: four pass; `mountain-door-landing` fails with an extra return crossing. Serving the committed `PlayScene` in memory reproduces the same journey and final-position failure. Its expectations were not weakened or re-recorded.

The previously identified expiring warden-key issue and cosmetic/gameplay RNG coupling were not changed by this structural refactor.
