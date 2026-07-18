# hitstop

**A 2D action game engine built on one belief: game feel isn't polish you add at the end — it's the foundation you build on.**

Frame-freeze hitstop, trauma-based screenshake, directional camera kicks, hit-flash, particle bursts, and synthesized SFX are first-class, composable primitives, available to every entity from day one. The long-term goal is a Metroidvania-scale action game in the spirit of Hollow Knight — and every layer added along the way has to keep combat feeling this good.

## Play online

**▶ [Play in your browser](https://wrwcmaster.github.io/hitstop/)** — the game is auto-deployed to GitHub Pages from `main` on every push (see `.github/workflows/deploy-pages.yml`). The design tools ship too: [level editor](https://wrwcmaster.github.io/hitstop/tools/level-editor.html) · [sprite editor](https://wrwcmaster.github.io/hitstop/tools/sprite-editor.html) · [sheet slicer](https://wrwcmaster.github.io/hitstop/tools/sheet-slicer.html).

## Quick start

```bash
npm install
npm run dev          # game:          http://localhost:5173/
                     # level editor:  http://localhost:5173/tools/level-editor.html
                     # sprite editor: http://localhost:5173/tools/sprite-editor.html
                     # sheet slicer:  http://localhost:5173/tools/sheet-slicer.html
npm run build        # typecheck + production build to dist/
npm run build:single # compile everything into hitstop.html (one file, no server)
```

No setup at all? Open **[`hitstop.html`](hitstop.html)** — the whole game compiled into a single self-contained file (committed for convenience; regenerate with `npm run build:single` after changes).

In-game: arrows/WASD move, Space jumps, `Z`/`J` attack (**contextual**: attack in the air for an aerial swipe, hold ↓ in the air to plunge — a hit **pogos** you back up, hold ↑ for an anti-air upper, or attack mid-dash for a thrusting dash attack), `X`/`K` dash, `C`/`L` fireball, `V` nova, `E`/`F` talk to NPCs, `Esc` opens the system menu (inventory, skill tree, options — including **key rebinding** under OPTIONS → CONTROLS), `` ` `` (backquote) toggles the debug overlay. **Gamepads work out of the box** (standard layout: A jump, X attack, B dash, Y interact, LB/RB skills, Start menu).

Beat the **Slime King** and the road to **Haven** opens — a town with a healer, a quest-giving elder, and a blacksmith who forges your weapon sharper. A **portal** in town (and at every key location) warps you between anywhere you've visited, so you can always get home. Save into any of three manual slots (or the autosave) from the title or the pause menu.

**Water:** the **Drowned Grotto** (through the mid-cavern gate, or the portal) is a flooded cavern — float at the surface, stroke with jump, hold down to dive, and watch your air bubbles: lungs empty means hearts start going. Air pockets trapped under rock refill your breath mid-dive. Mind the **pikes** — they only hunt what swims — and crack open the sunken **treasure chests** if you can hold your breath long enough. The skill tree's new tide tier (**DEEP LUNGS**) doubles down on diving.

**Multi-language:** switch under OPTIONS → LANGUAGE (English / 中文 so far). The engine's pixel font renders any script — non-ASCII glyphs are rasterized once into the same crisp pixel style, so adding a language is just a translation table (`src/game/content/locales.ts`), no glyph art.

**Online co-op, no server:** pick **CO-OP** on the title screen. The host sends an invite code to a friend over any chat; the friend replies with their code; paste it back and the two browsers connect *directly* (WebRTC peer-to-peer). The guest **brings their own saved knight** — gear, gold, forge levels — fights in the host's world with **client-side prediction** (movement feels instant, the host stays authoritative), and takes their co-op loot and XP home to their own save. Name your knight in the lobby — names float above each knight so you always know who's who. Copy-paste signaling means zero infrastructure, though very strict NATs may fail to connect (there's no relay server, by design).

`demo.html` is the original single-file proof of concept — zero dependencies, open it directly in a browser. Everything else in this repo is that POC grown into a real architecture.

## What's here

| Path | What it is |
| --- | --- |
| `src/engine/` | The engine: loop, events, input, graphics, **feel**, audio, physics, world, combat + projectiles, FSM, levels + triggers, items/equipment/stats, skills, UI (menus, dialogue, minimap). No game knowledge. |
| `src/game/` | The game built on it: player, enemies, weapons, spells, drops, conversations, town + NPCs (healer, quest elder, blacksmith), quests, a portal network, multi-slot saves, pause menu, HUD — mostly *content definitions*, not engine plumbing. |
| `tools/` | Browser-based design tools: level editor and sprite editor, sharing the game's registries ([guide](docs/design-tools.md)). |
| `docs/` | Architecture, game-feel guide, content cookbook, design-tools guide, and a game-dev primer for software engineers. |

## The pitch, in code

Hitting an enemy is one call, and the feedback bundle — hitstop, screenshake, directional camera kick, particles, damage numbers — is what the engine does by default, scaled by one `strength` knob:

```ts
const strike = game.combat.strike({ damage: 2, targets: 'enemy', strength: 0.8 });
strike.apply(attackBox);   // every update while the swing is active
```

A complete new enemy is ~20 lines of data + behavior (see `src/game/actors/enemies.ts`), and it automatically appears in the level editor's palette.

## Documentation

- [docs/architecture.md](docs/architecture.md) — how the engine is put together and why
- [docs/game-feel.md](docs/game-feel.md) — the feel system: what each primitive does and how to tune it
- [docs/adding-content.md](docs/adding-content.md) — cookbook: new enemies, tiles, rooms, sounds, skills
- [docs/design-tools.md](docs/design-tools.md) — the level editor, sprite editor, and PNG sheet slicer: controls, formats, and shipping your work
- [docs/game-dev-primer.md](docs/game-dev-primer.md) — game-dev concepts for software engineers, mapped to this codebase
- [AGENTS.md](AGENTS.md) — contributor guide for AI agents: hard rules, content recipes, verification playbook, PR workflow
