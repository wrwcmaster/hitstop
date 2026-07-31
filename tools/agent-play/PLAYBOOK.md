# Playbook — what the last agent learned about playing hitstop

Hard cap: **120 lines**. `npm run playbook` fails past it. This is a
working memory, not a log: when you add a line, delete a weaker one.
Entries earn their place by having been *measured*. Delete anything you
re-measure and find false, and say so in the PR.

```bash
node tools/agent-play/arena-trial.mjs --why --seeds 1,7,42,99,2024,5,13,77,300,808
```

Arena level 1. `cleared` = all five waves; `flawless` = not hit once.
Five seeds is noisy enough to reverse a verdict — a change measured
4/5 vs 3/5 was 8/10 vs 7/10 on ten. Use ten before believing anything.

## Where the bar is

| when | cleared | hits/run |
| --- | --- | --- |
| positions only | 0/5, died wave 3 | ~12 |
| + velocity, reach, i-frames, shots | 0/5, timeouts | 2-6 |
| + UI (`ui.blocking`) | 5/5 | 2-6 |
| + honest hitboxes, trimmed payload | 3/5 | 2-10 |
| + ranged & jump, properly modelled | 8/10 | 3-5 |
| + fixes found by PLAYING it | **6/10** | **3-8** |

Nobody has gone flawless. Damage: bats, then ranged, then brutes.

Two rows went DOWN and are still the better build. `inReach` used to be
a radius claiming she could hit a bat hovering above a chest-height
hitbox; correcting it cost two clears because the policy had been living
off the lie. Never restore a generous falsehood to recover a number.

## The rules that paid

- **Read the screen before the world.** A scene above `PlayScene` freezes
  the sim and takes the keyboard. Walking over a dropped weapon opens
  "Equip this?"; ignoring it cost 36,000 frames of standing still, a wave
  and a half from a win. `ui.blocking` -> `confirm`. 0/5 to 5/5, alone.
- **Never hold no keys.** Two traces caught her pressing NOTHING for a
  dozen frames while a bat closed from gap 17 to 0 — inside swing
  distance but unable to swing, and a ledge flag vetoing both directions.
  Repeated `-` in a trace IS the bug; no margin tuning touches it.
- **Judge a move over the window it COMMITS you for.** A swing is judged
  over `commitT` because she cannot dodge during it. A jump must be
  judged over its airtime (0.53s) for the identical reason — no air
  brakes. Priced over a footstep's 0.35s it looks safe because the
  scoring stops before the landing; that cost one seed fourteen hits.
  Modelled honestly, jump-as-an-option went 7/10 -> 8/10.
- **Read the distance that comes with a flag.** `ledgeLeft` means a drop
  *somewhere* left; `left: 94` says it is 94px off and her step is 38.
  Vetoing the direction cornered her with the arena open behind her.
- **Contact damage is a box overlap; reason in box gaps.** Demanding 34px
  of CENTRE distance with a 33px reach made "safe" and "in range"
  exclusive: 8 swings in 3000 frames, dead by attrition.
- **Back off after swinging.** The frames just after a commit expires are
  where the hits land, and the tempting move — swing again — is a trade
  she loses to brutes.
- **Fleeing is not a plan.** The arena is closed and the waves keep
  coming. Space has to be bought by killing things.

## Tried, measured, rejected

Each cost a full trial. Do not redo without a new reason.

- **Meet the charge**: swing early at a closing bat. 2-6 hits -> 3-10 and
  a death. Against contact damage the blade is not a shield.
- **Not jumping at incoming arrows**, reasoning that they arc rather than
  fly flat so leaving the ground cannot help. True about the physics,
  false about the outcome: 3/5 -> 1/5.
- **Reacting to the archer's drawn bow**: moving off the spot while it
  aims scored 3/5 -> 2/5; using it to pick a retreat direction changed
  nothing. The signal is real — 339 frames of it in one run — and
  unexploited. A genuinely open lead.

## What perception exists

`window.__observe()`, separate from `harness.state()` (the replay
divergence hash) and hashed by nobody. Add to it rather than guessing.
The HTTP bridge forwards it on every reply; `see: false` opts out.

- `ui` — `{top, blocking, ...scene.describe()}`; prompts report title,
  options, highlighted index.
- `player` — relative and terse: `w`/`h`, velocity, `facing`, `onGround`,
  `state`, `invulnT`, `attackReady`, `noise`, plus the swing (`reach`,
  `commitT`, `busyT` = seconds until the controls return), `jump` and
  `dash`. Reach is 23-33px by weapon and combo step, 0 for a ranged arm.
- `monsters[]` — stable `id`, then near (gap <= 200) gives `dx`/`dy`/
  `gap`, box, velocity, `facing`, `dmg`, and `flies`/`hp`/`mode`/`shoots`
  when they apply; far gives `{id, type, dx, distance:"far"}` plus
  `shoots`/`mode`, because a far slime is a rumour and a far archer is
  already drawing. `distance:"inReach"` is a VERDICT: a swing started now
  connects.
- `shots[]` — hostile and closing only; the rest is scenery.
- `space` — walking room each way, ledges, and `below` (drop beneath her,
  needed to model her own arc).
- `abilities` — verbs, mp, skills with `ready`/`cost`, weapon. The action
  list ships once with the session, not every step.

## How to debug without burning a day

- **Play it yourself before tuning.** Drive the bridge by hand for ten
  turns and read what comes back as if you had to act on it. Twenty
  minutes of that found more than a day of policy work: `space` lying
  while airborne, no monster ids, no countdown on a commitment, and a
  label saying "close" about something 194px away.
- **Read the replay before tuning.** Dump the 25 frames before each hit —
  keys, gaps, space. Every real gain came from that; none from moving a
  threshold. `arena-trial.mjs` scores, a frame trace diagnoses.
- Everything runs headless via `bootGame({fresh, seed})`. No browser.
- **One seed per boot.** The harness reads its seed once, so looping
  `beginRun` replays the same one and the runs differ only by leaked
  state. That looks exactly like seed variation.
- **Clearing is an event, not a counter.** `WaveRunner` stops at the
  goal; wait on `waveClear` with `wave >= 5`.
- **Death is an FSM state, not `Actor.dead`.** She sits in fsm `dead`
  with negative hp; check `hp <= 0` or deaths score as timeouts.
- **Verify the probe before the verdict.** Five conclusions here were
  probe bugs, not the game — one measured against a stale server that
  `pkill` had silently failed to kill on Windows.
