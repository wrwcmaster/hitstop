# hitstop

**A 2D action game engine built on one belief: game feel isn't polish you add at the end — it's the foundation you build on.**

Frame-freeze hitstop, trauma-based screenshake, directional camera kicks, hit-flash, particle bursts, and synthesized SFX are first-class, composable primitives, available to every entity from day one. The long-term goal is a Metroidvania-scale action game in the spirit of Hollow Knight — and every layer added along the way has to keep combat feeling this good.

## Quick start

```bash
npm install
npm run dev          # game:          http://localhost:5173/
                     # level editor:  http://localhost:5173/tools/level-editor.html
                     # sprite editor: http://localhost:5173/tools/sprite-editor.html
npm run build        # typecheck + production build to dist/
```

In-game: arrows/WASD move, Space jumps, `Z`/`J` attack, `X`/`K` dash, `C`/`L` cast fireball, `Esc` opens the system menu (inventory, volume, restart), `` ` `` (backquote) toggles the debug overlay (hurtboxes, entity counts, live time scale).

`demo.html` is the original single-file proof of concept — zero dependencies, open it directly in a browser. Everything else in this repo is that POC grown into a real architecture.

## What's here

| Path | What it is |
| --- | --- |
| `src/engine/` | The engine: loop, events, input, graphics, **feel**, audio, physics, world, combat + projectiles, FSM, levels + triggers, items/equipment/stats, skills, UI (menus, dialogue, minimap). No game knowledge. |
| `src/game/` | The game built on it: player, enemies, weapons, spells, drops, conversations, pause menu, HUD — mostly *content definitions*, not engine plumbing. |
| `tools/` | Browser-based design tools: level editor and sprite editor, sharing the game's registries. |
| `docs/` | Architecture, game-feel guide, content cookbook, and a game-dev primer for software engineers. |

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
- [docs/game-dev-primer.md](docs/game-dev-primer.md) — game-dev concepts for software engineers, mapped to this codebase
