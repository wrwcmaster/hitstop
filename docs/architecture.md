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
| `core/storage.ts` | `JsonStore` (versioned localStorage), `SlotVault` (autosave + N slots + newest), swappable backing | The backing swap (`sandboxStorage`) is what lets a replay viewer load a recording's saves without touching the player's real ones. |
| `replay/` | Deterministic record/replay: seeded boot, per-run input tapes, stepped time control for agents, the in-browser viewer | The engine owns the **mechanism**; the game supplies a small adapter (state extractor, run starter, action list). A run = seed + storage + input tape, because fixed steps + seeded gameplay RNG + action-only input make the sim a pure function of those three. |
| `input/input.ts` | Action-based input + `Buffer` + `Charge` | Gameplay reads *actions*, never keys. `Buffer` implements input buffering / coyote time; `Charge` is the hold-to-charge gesture (hold time → shaped power, with a "fully drawn" cue) — core feel tools. |
| `gfx/` | Pixel canvas, text-grid sprites, animation, 3×5 font, camera | Sprites are authored as text + palette: diffable, hand-editable, tool-friendly. Flip/tint/white-flash variants are cached. |
| `feel/` | **The selling point.** Particles, floating text, and `Feel` — hitstop, slowmo, flash, shake, kick, and the composed `impact()` | One `strength` knob (0..1) scales the whole bundle so feedback stays coherent. |
| `audio/` | `AudioBus` mixer (master/music/sfx gains), synth SFX registry, `Music` chip-tune sequencer | Songs are step patterns in a registry, scheduled ahead against the AudioContext clock; volume settings are just gain values on the bus. |
| `status/` | `StatusDef` registry + per-actor `Statuses` bag | Buffs/debuffs are content: duration, stat mods (auto-applied via sourced modifiers), periodic ticks, apply/expire hooks. |
| `progression/` | `Progression` (XP ledger with pluggable curve, skill points) + `TreeNodeDef` registry + `SkillTree` runtime | Tree effects are stat mods and/or unlock hooks; `restore()` re-applies everything from a save without re-spending points. |
| `physics/body.ts` | **The laws.** AABB bodies, gravity, axis-separated *swept* collide vs solids + one-way platforms, level `bounds`, collision contacts, `placeBody`, `carryBody` | Deliberately simple platformer physics — predictable and tunable beats realistic — but *uniform*: the four laws are stated at the top of the file and there are no exceptions to them. **(1) Integration**: position changes only by integrating velocity through `moveAndCollide`, which sweeps the travel path and is therefore correct at any speed (verified to 12,000px/s), not just under a `MAX_FALL` cap. **(2) Placement**: the only other way to acquire a position is `placeBody`, which resolves overlap the way the mover would and returns `false` when the spot is solid rock, so a caller can fall back instead of trusting a lie. **(3) Impulse**: mechanisms express themselves as velocity or as a swept `carryBody`, never by assigning `.x`/`.y` — because the mover only resolves a body moving INTO a solid from outside, a body that STARTS inside one is invisible to it and walks through stone. **(4) Presentation**: shivers and bobs are render offsets, never writes to the coordinates physics reads. `moveAndCollide` returns the contacts it resolved (body side, normal, exact solid, signed impact velocity, and one-way/dynamic/boundary traits) while retaining the result on the body for controllers and debug tools. `flies` means *no gravity and no landing* — flying bodies still collide with solids, they don't phase through rock. A collision source's optional `bounds` is the level's extent: bodies are kept inside it and departing projectiles measure against it, uniformly for every body; omit it for an unbounded world. |
| `world/` | `Entity`/`Actor` base classes, `World` with deferred spawn/remove and pluggable systems, `WaveRunner` | Classic entities, not ECS (see below). `Actor` carries the shared timers — `flashT`, `invulnT`, plus `hitstun` (AI suspended while > 0) and a `parrying` flag. `WaveRunner` sequences wave combat (queue → telegraphs → clear → breather → goal) over game-supplied compose/place/spawn callbacks. |
| `math/` | Vectors/rects/util + `ballistics.ts` (aim solvers) | `ballisticVelocity` solves a launch angle for a fixed muzzle speed under gravity (null when out of range); `ballisticLob` is the always-solvable mortar arc. Player bows and monster archers aim through the same pure functions. |
| `combat/combat.ts` | `Strike` (hitbox + damage + once-per-target tracking), hit application, **parry deflection**, and damage mitigation | **Feedback is applied inside the combat resolver.** A `parrying` target has its hit deflected to `onParried` (no damage) instead; `Strike.retarget` flips a strike to the other team (the parry's projectile reflection). `Actor.mitigate` lets a target reduce a blow before it lands (armor soak, resistances) and everything downstream — damage number, `hit` event, lethality — reports what ACTUALLY landed. |
| `combat/projectile.ts` | Bullets/bolts/arrows: a moving hitbox carrying a Strike, with optional gravity | Projectiles produce the same feedback bundle as melee. Gravity makes arrows arc and bullets drop; `reflect(vx,vy,bonus)` turns a shot back on the other team (parry). |
| `fsm/fsm.ts` | Tiny state machine with time-in-state | Player states, enemy AI, boss phases. |
| `level/` | Tile registry, `Tilemap` (collision + culling render), `RoomDef` JSON format, `Triggers` (event regions) | Rooms are plain JSON — the level editor's native format. Triggers script conversations/ambushes with zero code. Tiles carry generic content-owned `traits` plus flags the map answers as queries: `solid`/`oneWay`, `water` → `submersion(rect)`, `hazard` → `hazardAt(rect)`, and any content trait → `traitAt(rect, trait)` (the map answers WHERE a trait is without ever learning what it means — how Wall Grip finds out a wall is `slick`). `TileRef` and the point/overlap/cardinal-probe queries expose registered definitions with world geometry; `traceSurface` follows deterministic connected top surfaces while caller predicates decide their meaning. `Tilemap.extraSolids` is the dock for dynamic solids (moving platforms, barriers). `RoomPatches` records the difference between a room as authored and as the world left it — tile replacements plus entities that must not respawn, keyed by room id — and replays it over each fresh build. Plain JSON, so the same object serves saves, replay tapes, and net snapshots. |
| `items/` | `Stats` (sourced modifiers), `ItemDef` registry, `Inventory`, `Equipment` | Items are data + hooks; equipment projects stat mods under removable source keys. Weapons are just equipment whose props carry an attack spec. |
| `skills/` | `SkillDef` registry + `SkillBook` (cooldowns, resource gating) | The resource (mana/stamina/ammo) is abstracted behind two callbacks; casts usually fire Strikes/Projectiles so feedback comes free. |
| `ui/` | `drawPanel`/`Menu`/`drawBar` widgets, `DialogueScene` (typewriter + choices), `Minimap` (baked tiles + live markers) | Conversations are data in a registry; menus are the same widget everywhere. `drawBar` is the one way to draw a resource pool — player health/mana and the boss bar all use it. Its fill is a fraction of a pixel width rather than a whole icon, so any damage size reads as a distinct bite (a 10-point chip and a 30-point slam look different); a non-zero fill always paints at least one pixel, so "nearly dead" never looks like "dead". |
| `director/` | Scripted sequences over the live world: step timelines (`wait`/`call`/`tween`/`together`), skip-as-fast-forward semantics, letterbox state | Cutscenes are not a second renderer — they are the running simulation with scripted hands on the controls, which is what keeps them deterministic, replayable, and visible to co-op guests for free. The game builds steps from its own verbs (`content/cutscenes.ts`) and swaps a scripted `Input` in as `Player.source`, the same seam co-op remotes use. Skip never aborts: it fast-forwards, so a skipped cutscene leaves the world in exactly the state a watched one does. |
| `debug/overlay.ts` | Hurtboxes, velocity, collision normals/impact speeds, counts, time scale (`` ` `` key) | The fastest tuning loop is seeing the numbers live. Contact colors distinguish static, one-way, dynamic, and level-bound surfaces; the test room places each nearby for direct verification. |

## Mechanism in the engine, meaning in the game

The layering rule ("the engine doesn't know what a knight is") has a
constructive reading: when a *game system* turns out to be a general
*mechanism*, split it along that line instead of leaving it in game code.
The engine gets a small component parameterized by callbacks/config; the
game keeps a thin adapter that supplies content and presentation. Three
worked examples:

- **Wave combat** — `engine/world/waves.ts` owns the sequencing (spawn
  queue, telegraph timers, clear detection, breather, goal); the game's
  `WaveDirector` supplies wave composition from its tables, spawn
  placement, monster creation, and the banners/gate-key theatrics.
- **Record/replay** — `engine/replay/replay.ts` owns tapes, seeding,
  playback, and the viewer; the game's `test/harness.ts` supplies the
  action list, a state extractor, and how a run begins.
- **Saves** — `SlotVault` owns the autosave + N slots + newest-wins
  shape; the game owns what a save *contains* and how a player is
  snapshotted/restored.

The test for "does this belong in the engine?": could a different game on
this engine use it unchanged by swapping the callbacks? If the answer
needs an `if` about knights or slimes, it stays in the game (or becomes a
registry). Prefer extracting the mechanism over widening `PlayHost` or
growing `play.ts`.

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

- **Weapons** are first-class game content, separate from their inventory items. `content/weapons.ts` has a `weaponTypes` registry for reusable feel (combo length/window, duration, active frames, hitbox, lunge, strength, body motion, and trail) and a `weapons` registry that selects a type, visual, base damage, and colors. `content/weapon-visuals.ts` owns held rendering and normalized item icons derived from authored idle frames. Player resolves one `WeaponAttackDef` and executes it without assuming a combo length or a special heavy index.
- **Consumables/instants** (`potion`, `mana-orb`, `coin`) are `use`/`onPickup` hooks with a game-provided context. The `Pickup` entity (game side) handles the drop → magnet → collect loop.
- **Skills** cast via a `SkillBook` that gates on cooldown + resource. Input dispatch walks the active **class's** loadout (`content/classes.ts`), so adding or moving a skill slot is a content-table change rather than a Player branch.
- **Classes** (`content/classes.ts`) are lenses on the same knight: base stat mods (stats source `class:<id>`), a skill loadout, and a small per-class skill-tree grid. Change is free from the SKILL TREE screen and non-destructive — `Player.setClass` parks the old class's unlocked nodes, strips every effect it granted, and replays the new class's kit + remembered nodes (the same idempotent replay saves use). Skill points are one shared pool.
- **Player capabilities** are semantic flags/modifiers granted by tree-node hooks. Mechanics ask for `dashStrike`, `airJumps`, `skillCooldownScale`, or `dashCooldownScale`; they never ask whether node `w4`, `v4`, or `m2` is owned.
- **Parry** is a `parry` player state that opens a short guard window: incoming blows deflect (via `Actor.parrying` → `Combat.onParried`), the attacker staggers (`hitstun`), player-bound projectiles reflect in a front arc, and a success opens an empowered riposte. The engine seams are generic (see the combat/world rows); the timing, riposte, and reflection policy live in `player.ts`.
- **Conversations** are `ConversationDef` data played by `DialogueScene` as a stack overlay; rooms start them through `talk` triggers, so a level designer wires dialogue in the editor without code.
- **System menu** (`scenes/pause.ts`) composes the engine `Menu` widget; inventory/equip/volume/restart are menu entries with callbacks.
- **Minimap** bakes the tilemap once and draws live entity markers each frame.

## The play scene and its modules

`scenes/play.ts` owns the run/room lifecycle, score, and event wiring — and delegates everything else to focused modules under `scenes/play/`, each seeing the scene only through the narrow `PlayHost` seam (`play/host.ts`: live reads of game/player/tilemap/room + banner/goToRoom/openConversation):

- **`play/waves.ts` — WaveDirector**: runs a room's wave combat from a **wave table** (`content/waves.ts`, a registry — `props.waves: "<table id>"` names the recipe; rooms can run different gauntlets). Also handles `waveGoal`/`gateKey`: clearing the goal wave drops the key and stops the waves.
- **`play/trigger-actions.ts`**: what each trigger `event` means — behavior plus an optional definition-owned `validateProps`. `talk` and `door` validate their payloads before a room starts; custom unregistered events still flow through the event bus.
- **`play/doorways.ts`**: one geometry rule for outer-wall doors. It identifies the nearest edge, derives a collision-free opening through thick walls, and drives smooth walk-through transitions without room-specific cases.
- **`play/hud.ts` — Hud**: all in-game screen-space drawing (vitals, purse, level, statuses, minimap, boss bar, combo, banners) plus the world-space gate marker. Pure rendering; state stays in the scene.
- **`play/screens.ts`**: the title screen (menu + render) and the game-over overlay.
- **`play/cheats.ts`**: debug cheats as a data table — the key handler and the on-screen legend both walk it, so a new cheat is one entry.

`PlayHost` narrows what the *scene's* modules see. A parallel seam, **`ActorHost`** (`defs.ts`), narrows what the *simulation layer* sees: actors (player, monsters, gizmos) and the content callbacks they run (item `use`, skill `cast`, tree `onUnlock`, NPC `onChoice`) take an `ActorHost`, not the whole `Game`. It is exactly the services they need — `feel`, `combat`, `events`, `sfx`, `world`, `input`, `pad` — and deliberately omits the scene stack, camera, music, and loop, so an actor reaching for `game.scenes.switch()` or `game.camera` is a compile error, not a latent coupling. A full `ActionGame` satisfies it structurally, so creation sites pass `game` unchanged. The two actors that genuinely open scenes — `Npc` (shop/spawner) and `Pickup` (equip prompt) — keep the full `ActionGame`, which is the honest boundary: opening a scene *is* flow control.

## The world layer (rooms / boss / saves)

- **Rooms & doors**: the world is a `ROOMS` registry of RoomDefs connected by `door` triggers (`props.room` + spawn point). `PlayScene.setRoom` rebuilds tilemap/minimap/triggers behind a fade, `World.retain` keeps only the player, and waves run only in rooms with `props.waves`. The level editor's trigger mode places doors.
- **Placeables**: everything a room can put in the world lives in one catalog (`content/placeables.ts`) — label/category/colors/footprint for the tools, plus `validateProps`/`shouldSpawn`/`spawn` over the full `RoomEntity`. Built-in monster/NPC placeables reject unsupported instance properties; custom definitions validate the keys they consume.
- **Gear visuals**: armor-like equipment uses a layer registry (`content/gear-visuals.ts`) keyed by slot. Weapons use `weapon-visuals.ts`, a separate registry that owns both held art and attack trails while sharing the same optional frame-aligned sprite-sheet approach.
- **Bosses**: a boss is a monster with `boss: true` and an engine `FSM` driving telegraphed attack states. `MonsterDef.epilogue` names the after-kill conversation (default `'victory'`); a fallen boss sets a per-type `slain:<type>` flag so each stays down independently. Unusual touch behavior belongs to `onPlayerContact`; held-player effects to a `swallow` strategy. The Slime King (blob physics) and the human **Duelist** (rendered from her own sprite, a saber-and-pistol duelist with afterimage dashes) are the two references; the player runs a generic contact/held lifecycle and contains no monster ids.
- **Boss verbs so far**: **Air Step** (the midair jump) and **Impact Drop** (airborne down+attack) are earned, not given. `Player.maxAirJumps()` returns 0 without `air-step`, so the WIND tree's SKY DANCER node can only *add* a step (`extraAirJumps`) to a verb already won rather than grant it — the old node used to be the double jump itself. Impact Drop is resolved ahead of the ranged branch and falls back to `IMPACT_DROP_PLUNGE` when the weapon has no plunge of its own, so it stays a movement verb the knight owns rather than a property of her steel. **Wall Grip** is the third: a `cling` FSM state that reads the `CollisionResult` the player now keeps from `moveAndCollide`, asking it which side was touched instead of probing at hand-tuned offsets (so left/right symmetry is structural). One-way platforms and the level-extent backstop are excluded. Two short windows make it work: a wall is *remembered* for `wallStick` after contact — resting flush produces no overlap, so demanding a live contact every frame drops her a frame after she grabs on — and `regripT` after a kick both blocks re-gripping and suspends horizontal control, without which the still-held direction cancels the kick and she peels back down the same wall.
- **Earnables (permanent unlocks)**: anything a run wins and keeps — a key item, a unique off-tree skill, or a bare traversal verb. The mechanism is engine-side (`EarnedSet` + the `earnables` registry in `progression/progression.ts`) and deliberately says nothing about meaning: `kind` is an opaque label the game interprets, and `onEarn` is the projection that makes an unlock manifest (add the item, learn the skill, enable the capability). The game's catalog is `content/earnables.ts`; the ledger is `Player.earned`. Kept out of `PlayerCapabilities` on purpose: capabilities are the class kit and `setClass` wipes and replays them, so a reward stored there would be lost to a respec. Whoever hands it over names it (`MonsterDef.grants`), so `PlayScene` grants generically instead of switching on boss ids, and `main.ts` validates every `grants` against the catalog at boot. `grant()` returns true only the first time — that's what makes unlock feedback fire exactly once — while `restore()` replays projections silently (so it must be idempotent, exactly like `TreeNodeDef.onUnlock`). Persisted in `SaveData.player.earned` (absent = none), which co-op inherits for free because the hello/sync profile *is* `SaveData['player']`.
- **Shockwave (the fourth verb)**: one horizontal wave of force that runs away through the ground. Its input is **grounded down+attack**, chosen deliberately as the mirror of Impact Drop's *airborne* down+attack — down+attack means "send the force downward", into the floor beneath you in the air and along it when you're standing on it. That pairing costs no new `Action`, so touch buttons, gamepad bindings, the rebinding UI, the replay action list and `NET_ACTIONS` are untouched by construction. It sits beside Impact Drop *ahead* of the ranged branch, so a bow and a flintlock send the same wave a sword does — one verb the knight owns, no melee/ranged variants. The route is decided once at spawn by `Tilemap.traceSurface`, which is what makes its behavior at gaps, steps, corners and room bounds a property of the level instead of special cases: it stops on its own at a hole it can't step down into, a wall it can't climb, the map edge, or its range. Water is neither solid nor one-way, so it isn't a surface the trace can follow — a flooded stretch reads as a gap. It travels only through `resonant` tiles, and one `Strike` serves the whole wave, so its hit set is what guarantees each enemy is caught at most once. Deliberately not a `Projectile`: a projectile flies through space and dies on the first solid thing, which is the opposite of this.
- **Surface reactions**: a registry keyed by tile *trait* (`content/surface-reactions.ts`), fed by both verbs and told which one via `by: 'plunge' | 'wave'`. Tiles carry generic traits and the engine assigns them no meaning; this is the one place they acquire any, so a verb never names a tile and a tile never names a verb. `breakable` is its first entry, and both Impact Drop and Shockwave reach it without either knowing the other exists.
- **Room mutations that stick**: a `RoomDef` is immutable content rebuilt on every visit, so without help a smashed floor grows back the moment you leave. `PlayScene` owns a `RoomPatches` (engine) and applies it in `setRoom` right after `buildTilemap` — before the minimap, the camera bounds, or anything standing on it — and skips entities the patch has retired. One game-facing verb records changes, `PlayHost.mutateTile`, which writes the live map *and* the patch; the patch is what the next build replays. Entity identity is `entityKey` (`type@x,y`), not an array index, so editing a room cannot resurrect a looted chest and delete an untouched one; `MonsterDef.persistent` marks scenery that pays out once. What is *breakable* stays content's business: `crackedRock` carries the trait, the player emits `plungeLand` with the footprint she landed on, and `PlayScene.breakSurface` is the only place the word means anything. Bosses keep their own `slain:` flags, which also gate music and epilogues. Sandbox runs (test room, `?scenario=`) may break whatever they like — they never write a save.
- **Save compatibility**: the game is in **demo phase**, so old save data does not constrain design — optional fields default, and anything worse bumps the `SlotVault` version so old saves invalidate cleanly. In-game migration code is deliberately not written; after release the plan is a standalone migration pipeline outside the game. See *Save compatibility* in [AGENTS.md](../AGENTS.md).
- **Saves**: `JsonStore` (versioned localStorage) + `save.ts`. Checkpoints at every room entrance and boss defeat; death → last checkpoint at full HP; title screen offers CONTINUE. Fired one-shot triggers persist so intro dialogue doesn't replay.

## Where this goes next (Metroidvania roadmap)

The seams are already in place for:

- **Ability gating**: shipped for items — a door trigger with `props.key` stays locked until the player holds that item (the arena's gate key). Flag- or ability-gated doors are the same registered `door` action with one more check.
- **A world map screen**: `ROOMS` + door graph is the data; a paused overlay scene rendering visited rooms (flags) is the UI.
- **Fog-of-war minimap**: `Minimap.bake` is the single place that reads tiles; an explored mask slots in there.
- **NPCs**: an `Actor` with a `talk` interaction — the dialogue system and conversation registry are already in place.
