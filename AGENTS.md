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
```

## Hard rules

1. **Engine/game layering is strict.** `src/engine/` never imports from
   `src/game/`. The engine has no idea what a knight or a slime is. If a
   feature needs engine support, add a general mechanism (module,
   registry, hook) and drive it with game data.
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
src/engine/   core (loop/scenes/events), gfx, feel, audio, physics,
              combat, FSM, input, items/stats, level, ui, debug
src/game/
  defs.ts     actions, keymap/gamepad map, VIEW_W/H, ActionGame type
  main.ts     bootstrap: register content, bind touch buttons, start
  content/    the game's data: items, tiles, skills, statuses, music,
              sfx, conversations, shops, rooms/*.json, sprites/*.json,
              waves.ts (wave tables), gear-visuals.ts (equipment layers),
              quests.ts (quest defs + QuestLog), portals.ts (portal network)
  actors/     Player, Monster (+ enemies/boss defs), Npc (+ npc-roles
              factories: healer/forge/questGiver), Pickup
  scenes/     play.ts (orchestrator) + play/ modules, pause, options,
              shop, skilltree, prompt, spawner, background,
              saveslots (multi-slot save/load), portal (destination menu)
tools/        level editor, sprite editor, sheet slicer (client-only)
```

**PlayScene** (`scenes/play.ts`) owns the run/room lifecycle, score, and
event wiring — nothing else. Its moving parts live in `scenes/play/` and
see the scene only through the narrow **`PlayHost`** seam (`play/host.ts`):

| Module | Owns |
| --- | --- |
| `play/waves.ts` | WaveDirector: spawning, WAVE banners, `waveGoal` → gate-key drop |
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
- **Trigger type**: `defineTriggerAction` in `play/trigger-actions.ts`;
  definitions own both `run` and their optional `validateProps`. The
  `portal` trigger opens the portal menu; a `door` trigger reads `flag`
  as a story lock via `host.hasFlag`.
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
- **Sprite**: text-grid JSON in `content/sprites/` (author in the sprite
  editor; PNG art via the sheet slicer's "to sprite json"). Art is
  EPX-upscaled to 4× texel density; draw at `img.width / TEXEL`.

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
