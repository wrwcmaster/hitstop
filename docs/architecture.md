# Architecture

## The one-paragraph version

`Game` is the composition root: it owns the fixed-timestep `Loop`, the `Input` map, the `Camera`, the `World` of entities, the `Combat` resolver, the `Feel` system, and a `SceneManager`. Content — enemies, tiles, sounds, rooms — lives in *registries* and plain JSON, so adding to the game means registering definitions, not editing engine code. Combat feedback is not sprinkled through gameplay code; it's what `Combat` and `Feel` do by default.

```
┌─────────────────────────── Game ────────────────────────────┐
│  Loop (fixed 60Hz step, hitstop/slowmo live here)            │
│  Input (actions, buffering)      Sfx (synth, sound registry) │
│  Camera (follow, trauma shake)   Feel (impact composition)   │
│  World (entities + systems)      Combat (strikes → feedback) │
│  SceneManager (title / play / ...)   EventBus (typed)        │
└──────────────────────────────────────────────────────────────┘
        ▲ imports '@engine' only
┌───────┴──────────────────── game ───────────────────────────┐
│  scenes (PlayScene: waves, HUD)   actors (Player, Monster)   │
│  content: sprites, tiles, sfx, rooms/*.json  ← data, mostly  │
└──────────────────────────────────────────────────────────────┘
        ▲ same registries
┌───────┴──────────────────── tools ──────────────────────────┐
│  level editor (reads tile + monster registries, edits JSON)  │
│  sprite editor (edits the text-grid sprite format)           │
└──────────────────────────────────────────────────────────────┘
```

## Layering rules

1. **`src/engine/` never imports from `src/game/`.** The engine doesn't know what a knight is.
2. Games and tools import from `@engine/index` (the public API barrel) only — internal engine paths are free to move.
3. Content files (`src/game/content/`, `src/game/actors/enemies.ts`) register definitions at import time and export almost nothing. Adding content = adding a file + one import in `main.ts`.

## Module tour (`src/engine/`)

| Module | Responsibility | Key decision |
| --- | --- | --- |
| `core/loop.ts` | Fixed 60Hz simulation, render every frame | **Hitstop and slowmo are implemented in the loop itself** — a frozen frame freezes everything with zero cooperation from gameplay code. |
| `core/events.ts` | Typed pub/sub | Systems communicate through events (`hit`, `kill`, `waveStart`) so scoring/UI/AI can react without coupling. |
| `core/registry.ts` | Named content registries | The backbone of data-driven content; tools enumerate these to build their palettes. |
| `core/scene.ts` | Top-level game states on a **stack** | Only the top scene updates; every scene renders. Push a pause menu or dialogue and the frozen world stays visible under it — pausing falls out of the architecture instead of needing a flag. |
| `input/input.ts` | Action-based input + `Buffer` | Gameplay reads *actions*, never keys. `Buffer` implements input buffering / coyote time — core feel tools. |
| `gfx/` | Pixel canvas, text-grid sprites, animation, 3×5 font, camera | Sprites are authored as text + palette: diffable, hand-editable, tool-friendly. Flip/tint/white-flash variants are cached. |
| `feel/` | **The selling point.** Particles, floating text, and `Feel` — hitstop, slowmo, flash, shake, kick, and the composed `impact()` | One `strength` knob (0..1) scales the whole bundle so feedback stays coherent. |
| `audio/` | `AudioBus` mixer (master/music/sfx gains), synth SFX registry, `Music` chip-tune sequencer | Songs are step patterns in a registry, scheduled ahead against the AudioContext clock; volume settings are just gain values on the bus. |
| `status/` | `StatusDef` registry + per-actor `Statuses` bag | Buffs/debuffs are content: duration, stat mods (auto-applied via sourced modifiers), periodic ticks, apply/expire hooks. |
| `progression/` | `Progression` (XP ledger with pluggable curve, skill points) + `TreeNodeDef` registry + `SkillTree` runtime | Tree effects are stat mods and/or unlock hooks; `restore()` re-applies everything from a save without re-spending points. |
| `physics/body.ts` | AABB bodies, gravity, axis-separated collide vs solids + one-way platforms | Deliberately simple platformer physics — predictable and tunable beats realistic. |
| `world/` | `Entity`/`Actor` base classes, `World` with deferred spawn/remove and pluggable systems | Classic entities, not ECS (see below). |
| `combat/combat.ts` | `Strike` (hitbox + damage payload + once-per-target tracking) and hit application | **Feedback is applied inside the combat resolver**, so every hit in every future weapon/skill feels right by default. |
| `combat/projectile.ts` | Bullets/bolts: a moving hitbox carrying a Strike | Projectiles produce the same feedback bundle as melee — one tuning surface for all damage. |
| `fsm/fsm.ts` | Tiny state machine with time-in-state | Player states, enemy AI, boss phases. |
| `level/` | Tile registry, `Tilemap` (collision + culling render), `RoomDef` JSON format, `Triggers` (event regions) | Rooms are plain JSON — the level editor's native format. Triggers let rooms script conversations/ambushes with zero code. |
| `items/` | `Stats` (sourced modifiers), `ItemDef` registry, `Inventory`, `Equipment` | Items are data + hooks; equipment projects stat mods under removable source keys. Weapons are just equipment whose props carry an attack spec. |
| `skills/` | `SkillDef` registry + `SkillBook` (cooldowns, resource gating) | The resource (mana/stamina/ammo) is abstracted behind two callbacks; casts usually fire Strikes/Projectiles so feedback comes free. |
| `ui/` | `drawPanel`/`Menu` widgets, `DialogueScene` (typewriter + choices), `Minimap` (baked tiles + live markers) | Conversations are data in a registry; menus are the same widget everywhere. |
| `debug/overlay.ts` | Hurtboxes, counts, time scale (`` ` `` key) | The fastest tuning loop is seeing the numbers live. |

## Why entities + registries, not a full ECS

A pure ECS (components in arrays, systems iterating archetypes) buys cache efficiency and composition at the cost of indirection everywhere. At this game's scale — hundreds of entities, not hundreds of thousands — the bottleneck is *iteration speed of design*, not of memory. So:

- **Entities are classes** (`Actor` gives you body + health + facing + timers). Behavior reads top-to-bottom.
- **Composition happens at the definition level**: a `MonsterDef` is data + `init`/`update`/`draw` callbacks. Twenty lines makes a new enemy; the class supplies physics, damage handling, death feedback.
- **Cross-cutting logic goes in `World.systems`** (plain `(dt, world) => void` functions) — the escape hatch that an ECS would give you, without the ceremony.

If the game someday needs thousands of active entities, the `World` API (`spawn`/`actors`/`first`) is the seam where storage could be swapped without touching content.

## The update/render cycle

```
requestAnimationFrame tick
├─ frame(realDt)          — real time, even during hitstop:
│                            flash decay, blinking UI, overT timers
├─ if frozen: decrement freeze timer (this IS hitstop)
├─ else: accumulate scaled time, then 0..5 × update(1/60):
│   ├─ scene.update       — world.update (entities, then systems),
│   │                        waves, camera follow
│   ├─ feel.update        — particles, floating text
│   └─ input.endStep      — clear pressed/released edges
└─ render                 — scene.render (bg → camera → tiles → entities
                             → feel world layer → HUD) → feel screen flash
```

Two subtleties worth knowing:

- **Fixed timestep**: `update` always gets exactly 1/60s. Physics and feel tuning are deterministic; a slow machine drops steps instead of exploding.
- **Edge-triggered input is per-step**, not per-frame, so "pressed this update" is well-defined even when several updates run in one frame.

## Data formats

- **Rooms** (`RoomDef`): `{ name, tileSize, legend: {char→tileId}, tiles: string[], playerSpawn, entities: [{type,x,y,props?}] }`. `validateRoom` checks the transport shape; `validateRoomContent` then delegates open property bags to the registered placeable, trigger action, and room-feature definitions.
- **Sprites**: rows of palette characters + `{char→color|null}`. The sprite editor round-trips `{palette, frames, fps}`.
- Both are diffable text — deliberate, so game content works like code: reviewable, revertable, greppable.

## The tools are thin clients of the registries

The level editor imports the *game's* content modules; its tile palette is `tiles.ids()` and its entity palette is `monsters.ids()`. Register a new tile or monster and both editors know about it with zero editor changes. Test-play writes the room JSON to `localStorage` and opens the game with `?room=local` — a full edit→play loop in one click.

## The RPG layer (items / skills / dialogue / menus)

The second wave of systems keeps the same shape — registries of data + small hooks, engine mechanics with no game knowledge:

- **Weapons** are equipment items whose `props.weapon` carries a parsed attack spec (damage, feel strength, reach, colors and rendering fields). Invalid extensions fail with an item/property path instead of surfacing during a swing.
- **Consumables/instants** (`potion`, `mana-orb`, `coin`) are `use`/`onPickup` hooks with a game-provided context. The `Pickup` entity (game side) handles the drop → magnet → collect loop.
- **Skills** cast via a `SkillBook` that gates on cooldown + resource. Input dispatch walks `DEFAULT_SKILL_LOADOUT`, so adding or moving a skill slot is a content-table change rather than a Player branch.
- **Player capabilities** are semantic flags/modifiers granted by tree-node hooks. Mechanics ask for `dashStrike`, `airJumps`, or `skillCooldownScale`; they never ask whether node `w4`, `v4`, or `m2` is owned.
- **Conversations** are `ConversationDef` data played by `DialogueScene` as a stack overlay; rooms start them through `talk` triggers, so a level designer wires dialogue in the editor without code.
- **System menu** (`scenes/pause.ts`) composes the engine `Menu` widget; inventory/equip/volume/restart are menu entries with callbacks.
- **Minimap** bakes the tilemap once and draws live entity markers each frame.

## The play scene and its modules

`scenes/play.ts` owns the run/room lifecycle, score, and event wiring — and delegates everything else to focused modules under `scenes/play/`, each seeing the scene only through the narrow `PlayHost` seam (`play/host.ts`: live reads of game/player/tilemap/room + banner/goToRoom/openConversation):

- **`play/waves.ts` — WaveDirector**: runs a room's wave combat from a **wave table** (`content/waves.ts`, a registry — `props.waves: "<table id>"` names the recipe; rooms can run different gauntlets). Also handles `waveGoal`/`gateKey`: clearing the goal wave drops the key and stops the waves.
- **`play/trigger-actions.ts`**: what each trigger `event` means — behavior plus an optional definition-owned `validateProps`. `talk` and `door` validate their payloads before a room starts; custom unregistered events still flow through the event bus.
- **`play/hud.ts` — Hud**: all in-game screen-space drawing (vitals, purse, level, statuses, minimap, boss bar, combo, banners) plus the world-space gate marker. Pure rendering; state stays in the scene.
- **`play/screens.ts`**: the title screen (menu + render) and the game-over overlay.
- **`play/cheats.ts`**: debug cheats as a data table — the key handler and the on-screen legend both walk it, so a new cheat is one entry.

## The world layer (rooms / boss / saves)

- **Rooms & doors**: the world is a `ROOMS` registry of RoomDefs connected by `door` triggers (`props.room` + spawn point). `PlayScene.setRoom` rebuilds tilemap/minimap/triggers behind a fade, `World.retain` keeps only the player, and waves run only in rooms with `props.waves`. The level editor's trigger mode places doors.
- **Placeables**: everything a room can put in the world lives in one catalog (`content/placeables.ts`) — label/category/colors/footprint for the tools, plus `validateProps`/`shouldSpawn`/`spawn` over the full `RoomEntity`. Built-in monster/NPC placeables reject unsupported instance properties; custom definitions validate the keys they consume.
- **Gear visuals**: visible equipment is a **layer registry** (`content/gear-visuals.ts`) keyed by slot — a sprite sheet on the knight's frame grid plus optional per-frame anchors, composited in `order` (armor under helmet). The player render walks the registry, so a new visible slot (boots, cape, shield) is a JSON sheet + one `defineGearVisual` call.
- **Bosses**: a boss is a monster with `boss: true` and an engine `FSM` driving telegraphed attack states. Unusual touch behavior belongs to `MonsterDef.onPlayerContact`; held-player effects and overlays belong to its `swallow` strategy. Player only runs the generic contact/held lifecycle and contains no monster ids.
- **Saves**: `JsonStore` (versioned localStorage) + `save.ts`. Checkpoints at every room entrance and boss defeat; death → last checkpoint at full HP; title screen offers CONTINUE. Fired one-shot triggers persist so intro dialogue doesn't replay.

## Where this goes next (Metroidvania roadmap)

The seams are already in place for:

- **Ability gating**: shipped for items — a door trigger with `props.key` stays locked until the player holds that item (the arena's gate key). Flag- or ability-gated doors are the same registered `door` action with one more check.
- **A world map screen**: `ROOMS` + door graph is the data; a paused overlay scene rendering visited rooms (flags) is the UI.
- **Fog-of-war minimap**: `Minimap.bake` is the single place that reads tiles; an explored mask slots in there.
- **NPCs**: an `Actor` with a `talk` interaction — the dialogue system and conversation registry are already in place.
