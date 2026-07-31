# learn — a policy found by playing, not by taste

A small neural network trained to play the arena, in plain JavaScript
with no dependencies. It exists because a day of hand-tuning a rule-based
bot produced a pile of constants nobody could justify:

```js
const room = (m) => 6 + (m?.dmg ?? 0) / 4;   // why 6? why /4?
if (swingSafety(p, o) > need * 0.6)          // why 0.6?
recover = commitT * 60 + 10;                 // why +10?
```

Most of those were invented at the moment the branch was written. The few
that were A/B'd against seeds were fitting noise — differences of one or
two clears on ten runs. Here every one of them is a weight, found by
playing millions of frames, and the numbers nobody can defend are gone.

## Run it

```bash
node tools/agent-play/learn/train.mjs                      # ~15 min, writes weights.json
node tools/agent-play/learn/train.mjs --gens 80 --resume   # keep going
node tools/agent-play/arena-trial.mjs --policy ./learn/learned.mjs \
  --seeds 1,7,42,99,2024,5,13,77,300,808                   # score on UNSEEN seeds
```

## Where it got to

Held-out seeds (never trained on), full five waves:

| reward / episode | cleared | hits on the clears |
| --- | --- | --- |
| kills weighted 1x raw score, 1800-frame episodes | 0/10 | 5-9 |
| kill weight fixed, 4200 frames | 0/10 | 5-8 |
| 12000 frames, seeds rotated from a pool | 0/10 | 2-3, three survived to the cap |
| finishing rewarded | **3/10** | **1-2** |

For comparison the hand-written policy clears 6/10 but takes 3-8 hits
doing it. The learner clears less often and is markedly better at not
being touched — seed 2024 finished on 120/120 HP having been hit once,
the closest anything in this repo has come to an untouched clear.

Every step of that table came from a diagnosis, not a knob:

- **Kills were worth fifteen times a hit.** `kill: 1` multiplies raw game
  score, and a wave of kills scores over a thousand while a hit cost 60.
  It learned to trade, exactly as instructed. Read a weight against the
  units it multiplies.
- **It was trained on a prefix.** 1800 frames reaches wave 2; it was then
  scored on five waves, having never met a gunner.
- **Two fixed seeds is memorisation.** Zero deaths in training, dead on
  all ten held-out seeds. The pool now rotates, which costs nothing per
  generation.
- **Surviving is not finishing.** Time cost 160 over a whole run against
  400 for a wave, so three seeds ended alive on 110+ HP having never
  cleared. Finishing now pays 2000.

## How it works

| piece | what it is |
| --- | --- |
| `features.mjs` | `__observe()` → 68 numbers, scaled to about [-1,1] |
| `net.mjs` | 68-24-18 MLP, ReLU, argmax. 2,106 parameters |
| `rollout.mjs` | one episode + the reward, shared by training and scoring |
| `train.mjs` | evolution strategies, antithetic pairs, rank-normalised |
| `learned.mjs` | loads `weights.json`, plugs into `arena-trial.mjs` |

**Evolution strategies, not gradients.** The sim is a black box full of
hit-stop, state machines and discrete events; there is nothing to
differentiate through short of rewriting the game. ES only needs to be
able to *play*, and this sim plays at 7,500 frames/s in-process — an HTTP
gym wrapper would cap at ~70 turns/s and throw away two orders of
magnitude, which is why training lives in Node beside the sim.

**No library.** The artifact is 2,106 numbers and two matrix multiplies.
The repo ships zero runtime dependencies and this is not worth breaking
that for — it also means the same forward pass can run in the browser if
a monster ever needs one.

**Reward** (`rollout.mjs`): a hit costs more than a kill pays, or the
best strategy is to trade; time is charged a little, because a policy
that survives by refusing to engage is not solving the problem — the
hand-written one did exactly that and stalled past 25,000 frames looking
perfectly safe.

## Seeds are held out

Training rotates a small set of seeds; the score that counts comes from
seeds it never saw. This is not ceremony. The hand-written policy was
tuned on five seeds and reversed its verdict on ten, more than once, and
a network overfits harder and more convincingly than a human does.

## What this is really for

Beyond a better bot, it answers a question hand-tuning could not: **is a
perception field worth its tokens?** Train with it, train without it,
compare the score on held-out seeds. Delete a slot from `features.mjs`
and re-run. That is a real ablation, and it settles arguments like "does
`mode` earn its place" that a rule-based policy can never settle, because
its score moves for reasons unrelated to the field under test.

## If a net ever drives a monster

Then its output is part of the simulation and must reproduce, so it has
to be a pure function of hashed state: no wall clock, no `Math.random`
(use the seeded RNG), no iteration-order or async dependence, fixed
weights baked in. `forward()` already satisfies all of that.

Float precision is *not* the constraint it looks like. The sim already
steers a bat's position with `Math.sin` and applies drag with `Math.pow`,
so a net using transcendentals adds no new class of risk. Every replay
path today is V8 (Chrome, Edge, Node); a non-V8 engine could in principle
disagree, but that exposure predates any of this and is unmeasured.
