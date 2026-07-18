# AGENTS.md — working on hitstop

Guidance for AI agents (and humans) contributing to this repo. Read this
first; go deeper via the [docs index](#docs-index) at the bottom.

## What this is

A 2D action game + engine (TypeScript, Vite, canvas, **zero runtime
dependencies**) built on one belief: game feel — hitstop, screenshake,
squash & stretch — is the foundation, not polish. It's growing toward a
Metroidvania in the spirit of Hollow Knight. Every change must keep
combat feeling good and keep the architecture's seams clean.

## Commands

```bash
npm run dev            # dev server (game + tools as separate pages)
npm run typecheck      # tsc --noEmit — run after every change
npm run build          # typecheck + multi-page production build
npm run build:single   # everything → hitstop.html (also copies it to the repo root)
npm run replay         # replay saved runs, verify each reproduces exactly (regression guard)
npm run agent-play     # HTTP bridge for turn-based (LLM-agent) play
```

## Hard rules

1. **Engine/game layering is strict.** `src/engine/` never imports from
   `src/game/`. The engine has no idea what a knight or a slime is. If a
   feature needs engine support, add a general mechanism (module,
   registry, hook) and drive it with game data. When a game system turns
   out to be a general mechanism, extract it: engine component +
   callbacks, thin game adapter (see "Mechanism in the engine, meaning
   in the game" in docs/architecture.md; WaveRunner and replay/ are the
   worked examples).
2. **Content is data in registries, not special cases in code.** Items,
   monsters, NPCs, tiles, rooms, skills, statuses, conversations, shops,
   songs, SFX, wave tables, gear visuals, trigger actions, quests, portal
   destinations — all are `Registry` entries. Before adding an
   `if (id === 'thing')` anywhere, look for the registry that makes it a
   data change instead.
3. **No new runtime dependencies.** Dev-tooling (like Playwright) is fine.
4. **Verify in the running game, not just the compiler.** Typecheck and
   build prove it compiles; a Playwright drive of the real flow proves it
   works. See [Verification playbook](#verification-playbook).
5. **Rebuild `hitstop.html`** (`npm run build:single`) whenever
   game/engine code or content changes — it's the committed, playable
   single-file build. Tools-only or docs-only changes don't need it.
6. **Every UI works on desktop, mobile, and gamepad.** Menus must be
   tap-to-select (`Menu.tapAt` — render once, then taps hit-test), any
   new action needs a touch button in `index.html` + `bind()` in
   `main.ts` and a gamepad binding in `defs.ts`, and on-screen key
   prompts must be device-aware (see `Npc.promptLabel`), never a
   hardcoded "E".
7. **Registering a duplicate id throws.** Content ids are global per
   registry; pick a fresh id, or use `registry.replace()` only for a
   deliberate override.
8. **Listeners follow scene lifetime.** A scene that subscribes (event
   bus, input, `window`) keeps the unsubscribe/disposer and releases it
   in `exit()` — see PlayScene's `disposers` for the pattern.

## Architecture map

```
src/engine/   core (loop/scenes/events/storage), gfx, feel, audio,
              physics, combat, FSM, input, items/stats, level, ui, debug,
              replay (deterministic record/replay — game supplies an
              adapter), world (entities + WaveRunner),
              net (PeerLink: WebRTC DataChannel + copy-paste signaling)
src/game/
  defs.ts     actions, keymap/gamepad map, VIEW_W/H, ActionGame type
  main.ts     bootstrap: register content, bind touch buttons, start
  content/    the game's data: items, tiles, skills, statuses, music,
              sfx, conversations, shops, rooms/*.json, sprites/*.json,
              weapons.ts + weapon-visuals.ts (melee + ranged types),
              ballistics.ts (shared arrow/bullet shots), classes.ts
              (knight/mage/tidecaller), skilltree.ts (per-class nodes),
              waves.ts (wave tables), gear-visuals.ts (equipment layers),
              quests.ts (quest defs + QuestLog), portals.ts (portal network)
  actors/     Player, Monster (+ enemies/boss defs), Npc (+ npc-roles
              factories: healer/forge/questGiver), Pickup
  scenes/     play.ts (orchestrator) + play/ modules, pause, options,
              shop, skilltree, prompt, spawner, background,
              saveslots (multi-slot save/load), portal (destination menu),
              coop (P2P lobby: the copy-paste code exchange, DOM overlay)
  net/        online co-op: protocol.ts (wire types), host.ts (CoopHost:
              guest knight fed by a remote Input + 20Hz snapshots out),
              guest.ts (CoopGuestScene: renders snapshots via puppet
              actors — real render code, never simulated)
tools/        level editor, sprite editor, sheet slicer (client-only)
```

**PlayScene** (`scenes/play.ts`) owns the run/room lifecycle, score, and
event wiring — nothing else. Its moving parts live in `scenes/play/` and
see the scene only through the narrow **`PlayHost`** seam (`play/host.ts`):

| Module | Owns |
| --- | --- |
| `play/waves.ts` | WaveDirector: composition/placement/banners over the engine's `WaveRunner`; `waveGoal` → gate-key drop |
| `play/trigger-actions.ts` | What trigger events mean (`talk`, `door` + key lock) — a registry |
| `play/hud.ts` | All in-game screen-space drawing + the gate marker (pure rendering) |
| `play/screens.ts` | Title screen + game-over overlay |
| `play/cheats.ts` | Debug cheats as a data table (handler + legend both walk it) |

Extend by adding to these modules/registries — don't grow `play.ts` back
into a god class, and don't widen `PlayHost` casually.

## Content recipes

Details and code samples: `docs/adding-content.md`. The short version —

- **Item**: `defineItem` in `content/items.ts` (+ icon in
  `content/sprites/icons.json`; authored weapons derive theirs with
  `weaponIcon(...)`). Weapon items occupy the `weapon` slot; their combat
  definition lives in the separate weapon registry.
- **Weapon type / weapon**: `defineWeaponType` + `defineWeapon` in
  `content/weapons.ts`. Types own combo timing, per-swing hitboxes, lunges,
  trails, and feel strength; weapons select a type, visual, base damage,
  and colors. Player only executes the resolved attack definition.
  Types also carry the **contextual moveset** — optional `aerial`,
  `plunge`, `upper`, `dashAttack` entries the player resolves from her
  situation (airborne, airborne+down in dry air, up held, mid-dash).
  An attack's `aim: 'down' | 'up'` points its hitbox below the feet or
  above the head; `pogo: <speed>` makes an airborne down-hit bounce her
  up with air jumps and the dash refreshed. Plunges ride gravity and
  finish on landing; only grounded swings advance the combo chain.
- **Ranged weapon / ballistic shot**: give a weapon type a `ranged`
  block (`projectile: 'arrow'|'bullet'`, `speed`, `gravity`, `cooldown`,
  `recoil`) — the attack button then shoots instead of swinging (melee
  lists may be empty; the player braces through the cast state). Shots
  fire through `content/ballistics.ts` (`shootArrow`/`shootBullet`) —
  the same helpers monsters use — and are engine Projectiles with
  gravity, so arrows arc and bullets fly nearly flat. Monster aim uses
  the engine solvers `ballisticVelocity` (fixed speed, null when out of
  range) / `ballisticLob` (always solvable) from `math/ballistics.ts`;
  see the `archer`/`gunner` monsters. Tagged shots (`snapKind`) render
  properly on co-op guests (velocity rides the `ShotSnap`).
- **Weapon visual**: `defineWeaponVisual` in `content/weapon-visuals.ts`.
  Use `proceduralBlade(...)` for compact generated art or
  `spriteWeapon(...)` for a frame-aligned JSON sheet; sprite weapons
  normalize their idle frame into the item/pickup icon automatically.
- **Monster**: `defineMonster` in `actors/enemies.ts` (sprite, stats,
  drops, optional FSM for bosses in `actors/boss.ts`). Monsters and NPCs
  are bridged into the placeables catalog automatically.
- **Placeable** (anything else a room can contain — chest, checkpoint,
  destructible): `definePlaceable` in `content/placeables.ts`. One entry
  drives the game spawn, the level-editor palette, and the test spawner;
  read per-instance config from `RoomEntity.props` and validate it with
  the entry's `validateProps`.
- **Room**: author in the level editor → JSON in `content/rooms/` →
  register in `rooms/index.ts`. Doors are `door` triggers; a locked door
  adds `props.key: '<item id>'` (item lock) and/or `props.flag: '<flag>'`
  with `props.lockedText` (story lock — e.g. the throne→town gate needs
  `bossDefeated`). Waves via `props.waves: '<table id>'` (+ optional
  `waveGoal`/`gateKey`). Entering a room sets a `visited:<id>` flag.
- **Wave table**: `defineWaveTable` in `content/waves.ts`.
- **Water**: mark a tile `water: true` and rooms can flood — the
  tilemap answers `submersion(rect)` (area fraction) and the player does
  the rest: buoyancy floats her at ~3/4 submerged, strokes (jump) kick
  up, holding down tucks and dives, a stroke near the surface breaches,
  and the head being underwater drains `air` (drowning ticks at zero;
  surfaces and trapped air pockets refill). Tunables in `SWIM`
  (player.ts); `water`/`waterTop` tiles in `content/tiles.ts`; the
  grotto (`rooms/grotto.json`) is the reference flooded room, with
  pikes (water-bound hunters that only chase submerged players),
  breakable treasure chests (monsters with no teeth and rich drops),
  and the tree's tide tier (DEEP LUNGS grants `extraAirSeconds` +
  `swimBoost` capabilities the swim code reads).
- **Hazard tile**: set `hazard: <hearts>` on a tile def (`spikes` in
  `content/tiles.ts`) — the tilemap answers `hazardAt(rect)` (strongest
  overlapped hazard) and the player reacts after her move: damage +
  i-frames + an upward launch. Dashes and i-frames ignore hazards, so
  spikes are a route cost, not a wall.
- **Puzzle gizmo**: the machinery in `actors/gizmos.ts`, all placeables,
  wired together by *switch flags* (`switch:<id>` — ordinary story flags
  written via the `setFlag` event, so puzzle state persists in saves).
  `platform` (sine-glide solid that carries riders; props `w/h/dx/dy/
  period/phase`), `lever` (interact toggles its `switch` flag, latching),
  `plate` (holds its flag while stood on; `latch: true` for one-shot),
  `barrier` (solid while its flag is unset; `linger: <s>` keeps it open a
  beat after the flag drops — that's the timed-run mechanic). Platforms
  and barriers dock their `Solid` into `Tilemap.extraSolids`; nothing
  else in physics changed. The vault (`rooms/vault.json`, door in town)
  is the reference puzzle room.
- **Trigger type**: `defineTriggerAction` in `play/trigger-actions.ts`;
  definitions own both `run` and their optional `validateProps`. The
  `portal` trigger opens the portal menu; a `door` trigger reads `flag`
  as a story lock via `host.hasFlag`.
- **Class**: `defineClass` in `content/classes.ts` — base stat mods
  (source `class:<id>`), a skill loadout (which action slots exist,
  what starts known), branch names, and a small tree grid of node ids.
  Three shallow per-class trees replace one sprawling one; class change
  is free from the SKILL TREE screen's class tabs and non-destructive:
  `Player.setClass` parks the old class's nodes, strips every effect it
  granted (tree/class stat sources, capabilities, skills), and replays
  the new class's kit + remembered nodes — the same idempotent replay
  saves use, so `onUnlock` hooks must stay replay-safe. Skill points are
  one shared pool. Saves carry `classId` + per-class `trees`; old
  flat-tree saves migrate via `classOfNode`. Tree nodes themselves:
  `defineTreeNode` in `content/skilltree.ts`, then add the id to a
  class's grid (keep `requires` within that grid).
- **Parry / deflection**: built on three generic `Actor` seams (see
  `combat`/`world` in architecture.md) — the `parrying` flag (`Combat.hit`
  routes to `onParried`, no damage), `hitstun` (Monster AI suspended while
  > 0 → a staggered attacker), and `Projectile.reflect` + `Strike.retarget`
  (turn a shot on the other team). The knight's parry is a `parry` FSM
  state in `player.ts`: a guard window that deflects blows, reflects
  player-bound shots in a front arc, and opens a riposte (empowered next
  swing). Bound to `parry` (keyboard F/H, gamepad RT, touch shield; on
  `NET_ACTIONS`). To give an enemy a parry, set its `parrying` flag during
  a telegraphed beat and implement `onParried`.
- **Boss**: a monster with `boss: true`, a `displayName` (HP bar), an
  engine `FSM`, and optional `epilogue: '<conversation>'` (after-kill
  dialogue; default `'victory'`). Felling one sets `slain:<type>` so each
  boss stays down on its own. Two references in `actors/boss.ts`: the
  Slime King (scaled blob) and the human **Duelist** (own sprite +
  saber/pistol overlays + afterimage dashes). New boss art: a SpriteFile
  JSON in `content/sprites/`, loaded in `content/sprites.ts`.
- **Quest**: `defineQuest` in `content/quests.ts` (kill-N-of-a-monster
  goal + reward). The player's `QuestLog` is the runtime, fed by
  PlayScene's `kill` event, persisted in saves. A quest-giver NPC is one
  `questGiver({ quest, stages })` call (see below) — accept → progress →
  turn-in with zero combat code. Any monster type is a valid target.
- **Portal destination**: `definePortal` in `content/portals.ts` (target
  room + arrival coords + label). Drop a `portal` trigger and a gate
  visual in that room's JSON; the menu lists every destination the player
  has visited, so town is always reachable once seen.
- **NPC behaviour**: `defineNpc` in `actors/npc.ts`. `greet` can be a
  `(ctx) => conversationId` for state-driven dialogue; `onChoice(choice,
  ctx)` reacts to the picked choice's **`action`** id — never its display
  `label` — so writers reword prose freely. Prefer a reusable *role* from
  `actors/npc-roles.ts` (`healer`, `forge`, `questGiver`) over a bespoke
  `onChoice`: each returns an `NpcDef` from data (sprite + conversation +
  a cost/quest id), so a new service NPC is one call. A choice opens an
  attached `shop` when its `action` is `'shop'`.
- **Visible gear slot**: equipment JSON sheet on the knight's frame grid
  (transparent except the gear) + `defineGearVisual(slot, ...)` in
  `content/gear-visuals.ts`. No player-render changes.
- **Cheat**: one entry in `play/cheats.ts` (legend updates itself).
- **Language**: gettext-style — the English string IS the key. Add a
  table to `content/locales.ts` (`defineLocale('ja', { name, strings })`)
  and it appears in OPTIONS → LANGUAGE; untranslated strings fall back
  to English. Engine menus + dialogue translate at render time via
  `t()`; game code wraps its own drawText literals (`t('WAVE {n}',
  { n })` for templates). Non-ASCII glyphs (CJK etc.) render through the
  font's Unicode fallback: rasterized once from a system font at bitmap
  resolution, thresholded to hard pixels, wide chars advancing double —
  so foreign text keeps the pixel aesthetic with zero glyph authoring.
  CJK-aware dialogue wrap breaks per glyph (no spaces needed).
- **Sprite**: text-grid JSON in `content/sprites/` (author in the sprite
  editor; PNG art via the sheet slicer's "to sprite json"). Art is
  EPX-upscaled to 4× texel density; draw at `img.width / TEXEL`.

## Online co-op (how it works, and its edges)

Two players, one world, no server. The **host is authoritative**: the
guest's knight is a real `Player` in the host's world driven by a
remote-fed `Input` (`Player.source` — the game can't tell it from a
local knight), and 20 Hz JSON snapshots go back over one WebRTC
DataChannel (`engine/net/peer.ts`). Signaling is **manual**: the SDP
offer/answer travel as compressed base64 codes the players copy-paste to
each other (`scenes/coop.ts`) — no infrastructure, but peers behind
strict NATs may fail (STUN only, no TURN). The guest
(`net/guest.ts`) renders snapshots through **puppet actors** — real
`Player`/`Monster`/`Pickup` instances that are positioned and posed
(`fsm.set`) but never simulated, so poses, gear, trails, and the boss
bar come from the same render code — except the guest's **own** knight,
which is *predicted*: a real Player simulated locally (same tilemap,
live input) so movement feels instant, with the host's authoritative
position folded back in as a gentle correction (snap past 48px) and
dead/swallowed forced from the server. The guest's knight is also
**persistent**: a `hello` carries their saved player in
(`restorePlayer` on the host's copy), and the host syncs the knight
back every ~2s (`sync` → folded into the guest's autosave), so co-op
gold/XP/gear go home. Knights are **named** in co-op: a device-level
name (`name.ts`, edited in the lobby) rides the `hello` and snapshots
and renders as an overhead tag (`Player.name` — empty in solo, so no
tag). Puzzle gizmos cross the wire as
`giz` snapshot entries (kind + rect + one state bit, drawn with the same
shared `draw*` functions); the guest docks platform/closed-barrier
solids into its own tilemap so the predicted knight rides and collides
correctly. Known edges: dialogue/shops/pause are host-screen
only (NPCs ignore non-`isLocal` knights); projectiles render as generic
dots on the guest; strict NATs may fail (STUN only); levers answer only the
host's interact key (`interact` isn't a networked action), while
pressure plates feel both knights (the guest's is a real Player in the
host's world). When touching
multiplayer-adjacent code, keep the single-player path byte-identical —
`nearestPlayer()` and `isLocal` are the seams that keep both true.

## Verification playbook

Chromium for Playwright is preinstalled — launch with
`executablePath: '/opt/pw-browsers/chromium'`. Start `npm run dev` (pick
a port with `-- --port 5174`), then drive the real game:

- **Start a run**: click the canvas (audio unlock), press `Enter`
  (NEW GAME). The intro dialogue is branching — press `Z` ~18 times to
  clear it before testing movement.
- **Debug overlay**: `` ` `` (backquote). Shows hitboxes, entity counts,
  and arms the cheat keys — `5` god mode, `7` kill wave, `9` cycle
  helmet/armor gear layers, etc. (full table in `play/cheats.ts`). Use
  cheats to reach deep states fast instead of playing there.
- **Isolated test rooms**: write a RoomDef to
  `localStorage['hitstop.room']` and load `/?room=local` — the whole
  world becomes that one room. Perfect for placing one NPC/door/monster
  next to spawn. (The title's TEST ROOM entry loads
  `content/rooms/test_room.json`.)
- **Mobile**: emulate with `devices['Pixel 7'] + hasTouch`; touch
  controls appear only on coarse-pointer devices. Verify taps, the ☰
  menu button, and TALK.
- **Watch for regressions**: collect `pageerror`/console errors in every
  script; screenshot and actually look at the result.
- **Record/replay harness**: `npm run replay` re-runs every recording in
  `tools/agent-play/recordings/` and fails on any divergence — run it
  after gameplay changes (a diverging recording is either a regression or
  an intended change; re-record if intended). To play the game turn-based
  yourself (no real-time pressure) use the HTTP bridge:
  `npm run agent-play` — see `tools/agent-play/README.md`. Gameplay
  randomness must use the engine `rand/randInt/pick/chance` helpers
  (seeded, replayable), never `Math.random` (visual-only stream).

## Git & PR workflow

- Work on the designated `claude/...` branch; PRs target `main`. GitHub
  access goes through the MCP tools (no `gh` CLI here).
- **One PR per branch at a time.** If the branch's PR is still open, new
  commits join it (update its title/body to match). If it merged,
  restart the branch from `origin/main`
  (`git fetch origin main && git checkout -B <branch> origin/main`) and
  open a **new** PR — never stack on merged history.
- Commit as `Claude <noreply@anthropic.com>`
  (`git config user.email noreply@anthropic.com && git config user.name Claude`).
  GitHub's own PR merge commits show as "Unverified" with
  `noreply@github.com` — they are already in `main`; do **not** rewrite
  them.
- A PR body states what changed, why, and how it was verified.
  `main` auto-deploys to GitHub Pages, so only merge verified work.

## Style

- Match the existing voice: sentence-case UI prose, comments that
  explain *why* (constraints, feel decisions), tuning constants named
  and grouped (see `PLAYER_TUNING`).
- Feel first: new combat interactions should route through
  `Combat.hit`/`Strike` so hitstop/shake/flash come for free.
- Keep modules focused; if a file starts collecting unrelated concerns,
  split it along a narrow seam (the `play/` split is the model).

## Docs index

- `docs/architecture.md` — engine/game layering, registries, play/ seams
- `docs/adding-content.md` — step-by-step content recipes
- `docs/design-tools.md` — level editor, sprite editor, sheet slicer
- `docs/game-feel.md` — the feel toolkit and its tuning philosophy
- `docs/game-dev-primer.md` — background concepts
