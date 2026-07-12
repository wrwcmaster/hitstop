# Game feel: the primitives and how to tune them

This engine's thesis: **combat feedback is a systems problem, not an art problem.** Every primitive below is available everywhere, they compose, and they all scale from a single `strength` knob when used through `feel.impact()`. This doc explains what each one does to the player's perception, and where its numbers live.

## The primitives

### Hitstop (`feel.hitstop(sec)`)

Freezes the *entire simulation* for a few frames on impact. This is the single highest-value feel technique in action games: the freeze reads as the sword meeting resistance, and it gives the eye a beat to register the hit.

- Implemented in `core/loop.ts` — the loop stops stepping, so entities, particles, and camera all freeze together. Nothing needs to opt in.
- Ranges that work at 60fps: light hit 0.03–0.06s, heavy 0.08–0.12s, kill 0.12–0.15s. Beyond ~0.2s it reads as lag, not impact.
- Screen flash and UI blinking keep animating during hitstop (they run on real time via the loop's `frame` hook) — total stillness feels like a crash.

### Slow motion (`feel.slowmo(sec, scale)`)

Same mechanism, partial: the simulation runs at `scale` speed. Use sparingly for *moments* — the player's death, a boss phase transition. The demo uses 0.9s at 0.35× on player death.

### Screenshake (`feel.shake(amount)` / `camera.trauma`)

Trauma-based: hits *add trauma* (clamped 0..1), shake magnitude is **trauma²**, decaying linearly. Because of the square, small hits barely wiggle while big ones slam, and overlapping hits stack naturally instead of jittering.

- Numbers live in `gfx/camera.ts`: `shakeAmp` (max pixel offset, 7px at 480×270), `traumaDecay` (1.6/s).
- Typical adds: light hit 0.15–0.2, heavy 0.4, kill 0.5, player hurt 0.5–1.0.
- Shake is noise (random offset per frame). For *directional* feedback use kick:

### Camera kick (`feel.kick(dx, dy)`)

An impulse offset that exponentially springs back. Kicking the camera 2–5px *along the hit direction* is what makes a blow feel like it has a vector, not just magnitude. Almost free, hugely underused.

### Hit-flash (`Actor.flashT` + `whiteOf(sprite)`)

The struck sprite renders as a solid white silhouette for ~0.12s. Confirms *which* entity took the hit. `whiteOf` caches the silhouette per sprite, so it costs one composite per sprite ever.

### Particles (`feel.burst(x, y, n, opts)`)

Directional sprays sell impact direction and material (spark colors for hits, the monster's palette for gibs). Squash particle counts, not sizes: 7 for a light hit, 12–16 for heavy, 16+width for a kill. All rectangles — this is pixel art.

### Floating text (`feel.text(x, y, str, color, scale)`)

Damage numbers scale with the hit (1× white for light, 2× gold for heavy). Blinks out in the last 30% of its life.

### Screen flash (`feel.flash(alpha, color)`)

Full-screen color pulse. White at 0.18 on kills; red 0.35 when the player is hurt (color = whose blood it is). Decays on *real* time so it's visible through hitstop.

### Synth SFX (`sfx.play(id)`)

Every impact needs a sound, even a placeholder. Two synth primitives (pitch-sweep `tone`, noise-burst `hiss`) cover hits, jumps, dashes, deaths. Sounds are registered by id in `src/game/content/sfx.ts`; layering a tone + a hiss is the house style for impacts.

## Composition: `feel.impact()`

```ts
feel.impact(x, y, { strength: 0.8, dir: attackDir, colors: monster.def.colors });
```

One call produces hitstop + shake + kick + directional burst (+ flash and SFX if asked), all scaled from `strength`:

| strength | reads as | hitstop | shake |
| --- | --- | --- | --- |
| 0.2 | tick / chip damage | 0.05s | 0.17 |
| 0.45 | standard sword hit | 0.07s | 0.28 |
| 0.8 | heavy finisher | 0.10s | 0.44 |
| 1.0 | kill / explosion | 0.12s | 0.53 + white flash |

`Combat` calls `impact()` automatically for every connected `Strike`, upgrading `strength` to ≥0.9 on kills. That's the architectural point: **you cannot forget to add feedback**, and tuning the curve in `feel/feel.ts` retunes the entire game at once.

## Movement feel (in `actors/player.ts`, all in `PLAYER_TUNING`)

Combat is half the story; the other half is that *moving* feels right:

- **Coyote time** (0.1s): you can still jump shortly after walking off a ledge.
- **Jump buffering** (0.12s): jump pressed slightly before landing still jumps.
- **Jump cut**: releasing jump clamps upward velocity — variable jump height.
- **Attack buffering** (0.16s): mash-friendly combo chaining.
- **Squash & stretch**: 1.35× tall on jump, 0.6× on hard landing, anchored at the feet.
- **Dash i-frames** (0.2s): dashes read as decisive because they're briefly invincible.
- **Camera lookahead**: the camera leads by facing + velocity, so you see where you're going.

## Tuning workflow

1. Run `npm run dev`, press `` ` `` for the debug overlay (hurtboxes, live time scale, trauma).
2. Numbers are deliberately concentrated: `PLAYER_TUNING`, `feel.impact()`'s curves, `Camera`'s three constants, and each `MonsterDef`.
3. Change one number at a time and *hit something*. Feel tuning doesn't happen in your head.
4. When a moment feels wrong, check the channels in order: sound → hitstop → direction (kick/particles) → magnitude (shake/count). It's usually a missing channel, not a wrong magnitude.
