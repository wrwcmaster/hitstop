# Game dev for software engineers — a field guide to this codebase

You already know how to build software. Games differ in a few specific, learnable ways. Each concept below is mapped to where it lives in this repo so you can read real code instead of theory.

## 1. The game loop is an event loop you own

A game is `while (true) { readInput(); update(dt); render(); }`. The subtlety is **timing**:

- **Variable timestep** (`update(realDt)`) is simple but nondeterministic: physics behaves differently at 30 vs 144 fps, and collisions tunnel on slow frames.
- **Fixed timestep** (this engine, `core/loop.ts`): simulation always advances in exact 1/60s steps; rendering runs whenever the browser paints. Slow frames run multiple steps; fast displays just render more often. Determinism is what makes tuning ("dash lasts 0.16s") mean something.

The classic essay is Glenn Fiedler's *Fix Your Timestep* — our loop is that pattern plus time control (hitstop/slowmo) built into the stepper.

**Habit to unlearn:** `a += (b-a) * 0.1` per frame. That's frame-rate-dependent. Use the helpers in `math/util.ts` (`damp`, `friction`) which take `dt`.

## 2. State machines beat booleans

Your instinct will be `isJumping`, `isAttacking`, `isDashing` flags. Three booleans = 8 states, most invalid, all reachable. Games use **finite state machines**: the player is in exactly one of `move | attack | dash | dead`, each with its own enter/update/exit (`fsm/fsm.ts`, used in `actors/player.ts`). Time-in-state (`fsm.t`) replaces most ad-hoc timers. Enemy AI and boss phases are the same pattern.

## 3. Update order is architecture

In a web app, ordering mostly doesn't matter; in a game it's everything. Our canonical frame:

```
input edges → entity updates (intent → velocity) → physics (velocity → position)
→ combat resolution → camera → render
```

When something feels subtly wrong (jitter, one-frame lag), the bug is almost always ordering — e.g. camera following a position from before physics ran. See `core/game.ts` and `scenes/play.ts` for the committed order.

## 4. Collision: everything is rectangles until proven otherwise

AABB (axis-aligned bounding box) overlap tests + axis-separated movement (move X, resolve; move Y, resolve) handle a platformer completely — `physics/body.ts` is ~80 lines. Concepts worth knowing:

- **One-way platforms**: only collide when falling onto them from above.
- **Hitbox vs hurtbox**: the area your attack covers vs the area where you can be hit. Decoupling them is a balance tool (generous hitboxes for the player, forgiving hurtboxes against enemies = "fair").
- **Tunneling**: fast object skips over a thin wall between steps. Fixed timestep + speed caps (`MAX_FALL`) is our answer; real engines also sweep.

## 5. "Game feel" is a real discipline

The difference between a game that feels crunchy and one that feels floaty is ~15 tricks with names — hitstop, screenshake, input buffering, coyote time, squash & stretch, lookahead cameras. This repo treats them as its core feature; read [game-feel.md](game-feel.md). Two books worth your time: *Game Feel* (Steve Swink) and the GDC talk *The Art of Screenshake* (Jan Willem Nijman).

## 6. Content wants to be data

Engineers over-generalize engines and under-invest in content pipelines. The ratio that ships games is a small engine + a fat, boring content layer. Here: enemies are `MonsterDef`s, rooms are JSON, sprites are text grids, sounds are registered closures. The test of the pipeline is "how long from idea to seeing it in game?" — the level editor's one-click test-play exists precisely for that loop.

## 7. Events decouple game systems

Scoring, drops, quests, achievements, UI reactions — none of these should live inside combat code. Combat emits `hit`/`kill`; interested systems subscribe (`scenes/play.ts` turns `kill` into score). This is the observer pattern you already know; games just lean on it unusually hard because *everything* wants to react to *everything*.

## 8. Randomness needs taste (and eventually seeds)

Use randomness for texture (particle speeds, hop timers: `rand`, `chance` in `math/util.ts`), never for fairness-critical outcomes without design intent. When you later want replays or daily runs, you'll swap `Math.random` for a seeded RNG behind those same helpers — that's why they're wrapped.

## 9. Performance model: allocation and draw calls

At 60fps you have 16ms. In JS the usual killers are per-frame allocation (GC pauses = stutter) and canvas state changes. Practices used here: bake sprites/variants once and cache (`whiteOf`, `tintOf`), render tiles only in view, reuse arrays, keep particles as plain objects in one array. Profile before optimizing further — hundreds of entities are fine.

## 10. Vocabulary cheat sheet

| Term | Meaning | Here |
| --- | --- | --- |
| dt / delta time | Seconds since last update | Always 1/60 (fixed) |
| i-frames | Invulnerability window after being hit / during dodges | `Actor.invulnT` |
| telegraph | Visible warning before an attack/spawn | Spawn markers in `PlayScene` |
| juice | Feedback abundance (feel) | `feel/` |
| kiting | Attacking while staying out of reach | What bats force you to deal with |
| pixel-perfect | Integer-scaled, crisp pixels | `gfx/canvas.ts` |
| parallax | Background layers scrolling slower than foreground | `scenes/background.ts` |
| spawner / director | System deciding what/when to spawn | Wave logic in `PlayScene` |

## Suggested first exercises in this codebase

1. **Tune**: halve `PLAYER_TUNING.jumpSpeed`, play, restore. Feel what one number does.
2. **New enemy**: copy `slime`, make it flee when the player faces it (compare `player.facing` and relative position).
3. **New room**: build one in the level editor with a bat ambush, test-play, save the JSON.
4. **New feedback**: give the brute's landing a `feel.impact` with `strength: 0.6` and feel the difference.
5. **New system**: a `World` system that heals the player 1 hp on `waveClear` — events + systems in one exercise.
