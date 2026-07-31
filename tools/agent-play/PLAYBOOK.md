# Playbook — what the last agent learned about playing hitstop

Hard cap: **120 lines**. `npm run playbook` fails past it. This is a
working memory, not a log: when you add a line, delete a weaker one.
Entries earn their place by having been *measured*. Delete anything you
re-measure and find false, and say so in the PR.

Score yourself the same way, so the numbers compare:

```bash
node tools/agent-play/arena-trial.mjs --why
```

Five seeds of arena level 1. `cleared` = all five waves. `flawless` =
cleared without taking a single hit.

## Where the bar is

| when | cleared | hits per run |
| --- | --- | --- |
| positions-only perception | 0/5 (died wave 3) | ~12 |
| + velocity, reach, i-frames, shots | 0/5 (timeouts) | 2-6 |
| + UI perception (`ui.blocking`) | **5/5** | **2-6** |

Nobody has gone flawless yet. The remaining damage is mostly bats, then
archers and gunners at range, then brutes. That is the open problem.

## The rules that paid

- **Read the screen before the world.** A scene on top of `PlayScene`
  freezes the sim and takes the keyboard. Walking over a dropped weapon
  opens "Equip this?"; ignoring it cost 36,000 frames of standing still,
  a wave and a half from winning. `o.ui.blocking` -> press `confirm`.
  This one change took clears from 0/5 to 5/5 and changed nothing else.
- **Contact damage is a box overlap, so reason in box gaps.** Distance
  between centres is a different game's geometry. A policy that demanded
  34px of centre distance before swinging could never swing at all: her
  reach is 31px, so "safe" and "in range" were mutually exclusive, and
  she attacked 8 times in 3000 frames and lost by attrition.
- **Score the path, not the destination.** "Run through the slime" ends
  up somewhere lovely. Sample the whole crossing, each threat led forward
  by the time she will actually have taken to get there. Same mistake the
  engine's mover made before it swept.
- **A swing is a promise to stand still.** `player.commitT` is how long.
  Judge the swing over that entire window with her pinned in place, or
  she swings at things that were safe when she pressed and touching her
  when the animation released.
- **Back off after swinging.** The frames just after a commit expires are
  where the hits land: still shoulder-to-shoulder, and the tempting move
  (swing again) is a trade she loses to brutes.
- **Fleeing is not a plan.** The arena is closed and the waves keep
  coming. Space has to be bought by killing things.

## Tried, measured, rejected

Do not re-run these without a new reason — each cost a full trial.

- **Meet the charge**: swing early at a closing bat, since she cannot
  outrun 80px/s. Hits went 2-6 -> 3-10 and a run died. Against contact
  damage the blade is not a shield.
- **Speed-scaled safety margin**: demand more air in front of fast
  things. Sounds right, measured worse — 24 hits across the seeds
  against 20, and slower runs, because a wider no-go zone means more
  time retreating and less time ending the wave.
- **Jumping at an overhead bat**: meets the dive instead of avoiding it.

## What perception exists

`window.__observe()` — separate from `harness.state()` on purpose, and
hashed by nobody, so it is free to grow. Add to it rather than guessing.

- `ui` — `{ top, blocking, ...scene.describe() }`. A prompt reports its
  title, options and highlighted index.
- `player` — position, velocity, `facing`, `onGround`, `state`,
  `invulnT`, `attackReady`, `reach`, `commitT`, `noise`.
- `monsters[]` — box, velocity, hp, `flies`, `contactDamage`, signed
  `dx`/`dy`, `dist`, `inReach`, and `mode` when the behaviour names its
  phase. Wave-1 enemies (slime, bat, brute) name none — their hits are
  pure spacing, not missed telegraphs. Do not go looking for a tell.
- `shots[]` — arrows and bullets, with `closing`.
- `space` — walking room each way and whether the floor continues.
- `abilities` — every action, earned verbs, mp, skills with `ready` and
  `cost`, the equipped weapon.

## How to debug without burning a day

- Everything runs headless: `bootGame({ fresh, seed })` from
  `headless.mjs`. A browser is never needed to measure play.
- **One seed per boot.** The harness reads its seed once, at boot, so
  looping `beginRun` replays the same seed and the runs differ only by
  leaked state. That looks exactly like seed variation. It is not.
- **Clearing is an event, not a counter.** `WaveRunner` stops at the
  goal — the counter never passes 5. Wait on `waveClear` with
  `wave >= 5`. Polling for `wave > 5` waits forever and scored two real
  clears as timeouts.
- **Verify the probe before believing the verdict.** Three separate
  conclusions here were probe bugs, not game behaviour. Before trusting
  a passing check, break the thing it checks and watch it fail.
- When a run stalls, dump what is *actually* blocking progress — the
  scene stack and the wave runner's own fields — before theorising about
  monsters. The stall was never in the fight.
