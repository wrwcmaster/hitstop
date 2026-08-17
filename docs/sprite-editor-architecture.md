# Sprite editor architecture

The sprite editor is a document editor, not a collection of unrelated canvas
controls. A `SpriteFile` is one aggregate: animation timing, every layer track,
frame order, anchors, attachment slots, palette, geometry, and hitbox must move
together or the file becomes valid only for the currently visible screen.

## State boundaries

Keep the editor's state in four explicit categories:

| State | Examples | Lifetime |
| --- | --- | --- |
| Sprite document | pixels, layers, animations, anchors, palette | undoable, draftable, saved |
| Document cursor | animation, frame, active layer | reconciled after every document replacement |
| Interaction | active stroke, drag, transform, anchor placement | ends on pointer-up, blur, or document switch |
| Workspace/view | open sprite, panels, zoom, composite choices | preserved across Save All and reload |

Selection has two parts: its mask belongs to the undo snapshot because a pixel
edit can depend on it, while an in-progress drag is interaction state and must
never survive a document switch.

## Document model

`tools/src/sprite-editor-document.ts` is the DOM-free model. It owns invariants
and structural operations that touch coupled arrays:

- frame insert, duplicate, delete, and reorder update every layer track and
  every matching anchor track, including alias-specific overrides;
- materializing an animation alias clones its resolved timing, every layer
  track, and its effective anchor paths into an independent timeline;
- layered timeline `frameCount` stays equal to every layer track;
- deleting an animation removes transitive aliases and associated tracks;
- resizing updates every concrete animation without assuming that flat-sprite
  animations originally share one canvas size;
- validation covers aliases, frame geometry, layers, anchors, attachment
  slots, palette values, physical geometry, and hitboxes.

The browser and the development bridge use this same validator. The bridge is
the filesystem boundary, so it must reject an invalid complete Save All batch
before writing any file.

`tools/src/sprite-editor-agent.ts` is the second DOM-free seam: a versioned,
discoverable semantic command engine over this document model. It executes a
batch against a clone, validates once at the boundary, and publishes only a
complete result. Cross-document reads are explicit; writes target only the
active revision. Its design and extension contract are documented in
[sprite-editor-agent.md](sprite-editor-agent.md).

`tools/src/sprite-editor-workspace.ts` does the same job for the two other
persisted aggregates: ordered render tags and frame-native weapon combat
tuning. Browser-local drafts and bridge writes therefore cannot disagree about
ids, frame windows, or hitbox validity.

Run the model suite with:

```bash
npm run test:sprite-editor
```

The suite includes synthetic flat/layered edge cases and validates every
tracked sprite JSON file in the repository.

## Mutation protocol

A discrete edit goes through `commitDocumentEdit`. The transaction:

1. snapshots the document, selection, and cursor-related UI state;
2. performs the mutation;
3. validates the complete document;
4. rolls back both document and UI state on failure or a no-op;
5. creates one undo entry;
6. reconciles animation, frame, layer, anchor, slot, and selection bounds;
7. refreshes controls/canvas, persists the local draft, invalidates the
   preview, and publishes the shared revision.

Pointer gestures are continuous transactions. Painting and live transforms
may update pixels many times for responsive rendering, but they create one
undo entry and validate/persist/publish only when the gesture finishes. Window
blur, undo/redo, Save All, and a user-requested document switch are gesture
boundaries. An external document replacement cancels any remaining transient
gesture before installing the next document. Periodic draft/bridge timers skip
in-progress gestures, so collaborators never receive half of a transform.

Do not add a handler that calls some hand-picked combination of `saveHistory`,
`syncIO`, `redraw`, `schedulePreviewUpload`, or `publishSharedSprite`. That was
the source of most order-dependent bugs: the edit appeared correct until the
next frame, layer, sprite, save, or preview operation.

## Loading and collaboration

Parse, clone, normalize, and validate a replacement before changing the active
editor state. Repository modules, bridge payloads, undo snapshots, and caller
objects must never remain aliased to the mutable editor document.

Undo history belongs to one sprite path. Switching sprites clears it; a remote
revision of the same sprite adds the previous local state to it. Unsaved work
is stored per sprite path in local storage. Corrupt inactive drafts are ignored
without preventing the editor from opening. Save All validates and stages the
whole workspace before replacing repository files, without changing the
current animation, frame, layer, selection, or zoom.

## Workspace UX boundary

Professional-editor conventions are workspace commands, not sprite mutations.
Panel visibility, active inspector pages, canvas/preview zoom, Space-drag pan,
the shortcut dialog, and status-bar content must never advance the document
revision, create undo entries, or dirty a draft. They may be restored from the
session view snapshot and reset independently. Conversely, document commands
such as Select All, pixel deletion, transforms, and palette edits still route
through the ordinary selection or transaction seams.

Every modal tool state must be visible in three places: its pressed toolbar
control, the contextual tool name/gesture, and the cursor. Temporary states
(Alt picker, Space pan, anchor placement) must release on key-up, completion,
or window blur. This prevents the classic editor failure where the canvas is
still in a mode the controls no longer show.

## Further decomposition

`tools/src/sprite-editor.ts` still coordinates DOM rendering, pointer input,
preview composition, collaboration, and workspace persistence. New work should
extract along those boundaries rather than create feature-specific helpers:

- a session/controller for document installation, history, and transactions;
- a pointer gesture controller with explicit idle/painting/selecting/
  transforming states;
- preview composition as an input snapshot plus pure render step;
- small panel views that receive state and emit commands.

This can happen incrementally because the document model and transaction seam
now provide a stable center.
