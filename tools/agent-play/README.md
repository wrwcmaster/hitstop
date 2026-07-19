# agent-play — record/replay harness for humans and LLM agents

Every RUN of hitstop — a human playing live or an agent playing
turn-based — is recorded as an **input tape**: the run's RNG seed, the
`hitstop.*` storage it started from, how it started (new / continue /
slot / test room), and every action edge/tap tagged with the exact 1/60s
simulation step it landed on. Tapes are per-run: each run start
(including game-over restarts) cuts a fresh one, so a recording is one
clean run with no menu noise. Same seed + same tape ⇒ the same run, bit
for bit. A saved playthrough doubles as a deterministic regression test.

## Quick reference

```bash
npm run dev                       # the game
npm run agent-play                # HTTP bridge for turn-based (agent) play
npm run replay                    # verify EVERY recording in recordings/
npm run replay -- path/run.json   # verify one recording
```

`npm run replay` starts its own vite (port 5199) if the dev server isn't
already running, so it works as a one-command test suite.

## Saving and WATCHING a human run

Just play the game normally — recording is always on. Pause (Esc / ☰)
and pick **SAVE REPLAY**: the current run downloads as
`hitstop-run-<seed>-<time>.json`. (Also available from the devtools
console: `__replay.save('my-run')`.)

To watch one back, pick **WATCH REPLAY** on the title screen and choose
the file: the game reboots into a sandboxed viewer — the tape drives the
run in real time, your keyboard/touch/gamepad are muted, your real saves
are untouched (storage is in-memory for the session), and a progress
strip sits along the bottom. Esc exits (any tap once it ends). If the
run was recorded on an older build whose gameplay has since changed, the
strip flags where it diverged.

For CI-style verification, drop the file into
`tools/agent-play/recordings/` and `npm run replay` will verify it
forever after. Caveats: runs that used debug cheats (backquote overlay
keys bypass the input system) won't reproduce, and co-op runs are
skipped (network play can't replay — the recording is marked
`tainted`).

## Agent (turn-based) play

The bridge stops the game loop; time only passes when you POST a step, so
LLM latency doesn't matter — the game waits while you think.

```bash
curl -X POST localhost:8791/session -d '{"seed": 42}'
curl -X POST localhost:8791/step -d '{"down": ["right", "attack"], "frames": 30}'
curl localhost:8791/state                 # look, no time passes
curl localhost:8791/screenshot -o s.png
curl -X POST localhost:8791/save -d '{"name": "wave1-clear"}'
curl -X POST localhost:8791/shutdown
```

`step` semantics: `down` is the **complete** set of actions held during
those frames (diffed against the previous step to fire press/release
edges). A button *tap* is one step with the action + one step without.
Edge-triggered actions (attack, confirm, jump) fire on the press edge, so
`{"down":["attack"],"frames":30}` is ONE attack, not thirty.

Actions: `left right up down jump attack dash skill skill2 skill3 parry
interact confirm cancel menu`.

State is JSON: scene stack, `dialogue` flag (keep tapping confirm while
true; one intro line offers up/down choices), phase, wave, score, player
(pos/vel/hp/gold), monsters (type/pos/hp), and `timeScale` — 0 while
hitstop freezes the world, so game feel itself is assertable.

## How determinism works

- **Fixed timestep.** The sim only moves in exact 1/60s steps
  (`Game.steps` counts them). Freeze/slow-mo (hitstop) pace wall time,
  never step size — replays go through the same `Loop.advance` machinery.
- **Split RNG.** Gameplay draws from the engine `rand/randInt/pick/chance`
  stream, seeded at boot (`?seed=` or a remembered random seed). Visual
  noise (camera shake, star fields, sfx pitch) stays on unseeded
  `Math.random` and can't touch the sim. Keep it that way: new gameplay
  randomness must use the engine helpers, never `Math.random`.
- **Input is the only door.** Devices (keyboard/touch/gamepad/agent) all
  funnel through `Input` action edges and taps — `Input.onRaw` tapes them,
  replay re-injects them on the recorded steps.
- **State checkpoints.** A hash of the world state is recorded once per
  second of game time; replay compares each one and reports the first
  divergence — either nondeterminism or a real gameplay change (i.e. a
  regression the recording caught).

In-page pieces: the mechanism is the engine's `src/engine/replay/replay.ts`
(tapes, seeding, playback, the viewer, `window.__replay`/`__harness`);
`src/game/test/harness.ts` is the game adapter (action list, state
extractor, how a run begins).

## Environment knobs

- `HITSTOP_URL` — game base URL (default `http://localhost:5173/`)
- `AGENT_PLAY_PORT` — bridge port (default `8791`)
- `PW_EXECUTABLE` / `PW_CHANNEL` — browser override (defaults: bundled
  chromium, falling back to the `msedge` channel)
