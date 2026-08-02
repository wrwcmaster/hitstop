"""PPO trainer: the Python half of the loop. Dev-tooling only — the game
ships zero runtime dependencies and this file never touches it. Weights
travel as the same JSON blob net.mjs runs; the sim stays in Node at
7,500 frames/s (collect.mjs), and this side only does the maths.

    python tools/agent-play/learn/ppo.py --iters 30 --room throne

Why this exists: ES pays one scalar per episode, and twice it plateaued
because it could not see WHICH moments of a fight were good. PPO credits
per timestep — the critic prices each state, the advantage says whether
an action beat that price, and the clipped update nudges probabilities
without leaping. "Struck without being touched" finally has an address.

Layout contract: the policy trunk+head are EXACTLY net.mjs's flat blob
(per layer: weights row-major [out][in], then biases). The value head is
Python-only detail and persists in value.pt; the exported weights.json
stays loadable by every existing tool, including the validation gate.
"""
import argparse
import json
import subprocess
import sys
from pathlib import Path

import numpy as np
import torch
import torch.nn as nn

HERE = Path(__file__).parent
REPO = HERE.parent.parent.parent


def parse():
    ap = argparse.ArgumentParser()
    ap.add_argument("--weights", default=str(HERE / "weights.json"))
    ap.add_argument("--out", default=str(HERE / "weights.json"))
    ap.add_argument("--room", default="throne")
    ap.add_argument("--iters", type=int, default=30)
    ap.add_argument("--episodes", type=int, default=8)
    ap.add_argument("--epochs", type=int, default=4)
    ap.add_argument("--lr", type=float, default=3e-4)
    ap.add_argument("--clip", type=float, default=0.2)
    ap.add_argument("--gamma", type=float, default=0.99)
    ap.add_argument("--lam", type=float, default=0.95)
    ap.add_argument("--entropy", type=float, default=0.01)
    ap.add_argument("--valid-every", type=int, default=3)
    # Iterations where ONLY the critic trains. The policy arrives
    # pretrained (ES gen-9) and the value head arrives random, so the
    # first advantages are noise from an untrained critic — the 3-iter
    # shakedown lost 3,250 validation points to exactly that. Freezing
    # the policy until the critic can price states protects what ES
    # already earned.
    ap.add_argument("--warmup", type=int, default=3)
    return ap.parse_args()


class Policy(nn.Module):
    """Mirror of net.mjs: Linear -> ReLU -> Linear, plus a value head."""

    def __init__(self, shape):
        super().__init__()
        self.shape = shape
        self.l1 = nn.Linear(shape[0], shape[1])
        self.head = nn.Linear(shape[1], shape[2])
        self.value = nn.Linear(shape[1], 1)

    def forward(self, x):
        h = torch.relu(self.l1(x))
        return self.head(h), self.value(h).squeeze(-1)


def load_blob(model, path):
    blob = json.loads(Path(path).read_text())
    w = np.asarray(blob["weights"], dtype=np.float64)
    i0, h, o = model.shape
    at = 0
    model.l1.weight.data = torch.tensor(w[at:at + h * i0].reshape(h, i0), dtype=torch.float32)
    at += h * i0
    model.l1.bias.data = torch.tensor(w[at:at + h], dtype=torch.float32)
    at += h
    model.head.weight.data = torch.tensor(w[at:at + o * h].reshape(o, h), dtype=torch.float32)
    at += o * h
    model.head.bias.data = torch.tensor(w[at:at + o], dtype=torch.float32)
    return blob


def save_blob(model, blob, path, note, valid):
    i0, h, o = model.shape
    flat = np.concatenate([
        model.l1.weight.data.numpy().reshape(-1),
        model.l1.bias.data.numpy(),
        model.head.weight.data.numpy().reshape(-1),
        model.head.bias.data.numpy(),
    ]).astype(float)
    out = dict(blob)
    out.update(note=note, weights=list(flat))
    if valid is not None:
        out["validFitness"] = round(valid)
    Path(path).write_text(json.dumps(out))


def collect(weights_path, room, episodes, det=False, seeds=None):
    """One call into the Node collector; returns (steps, meanReturn)."""
    traj = HERE / "traj.jsonl"
    cmd = ["node", str(HERE / "collect.mjs"), "--weights", str(weights_path),
           "--out", str(traj), "--episodes", str(episodes), "--room", room]
    if not det:
        cmd.append("--rand-spawn")
    if det:
        cmd.append("--det")
    if seeds:
        cmd += ["--seeds", seeds]
    r = subprocess.run(cmd, cwd=REPO, capture_output=True, text=True)
    if r.returncode != 0:
        sys.exit(f"collector failed:\n{r.stdout}\n{r.stderr}")
    meta = json.loads(r.stdout.strip().splitlines()[-1])
    steps = [json.loads(line) for line in traj.read_text().splitlines() if line]
    return steps, meta["meanReturn"]


def gae(steps, values, gamma, lam):
    """Generalised advantage estimation over concatenated episodes."""
    adv = np.zeros(len(steps), dtype=np.float64)
    last = 0.0
    for t in range(len(steps) - 1, -1, -1):
        done = steps[t]["d"]
        v_next = 0.0 if (done or t + 1 >= len(steps)) else values[t + 1]
        delta = steps[t]["r"] + gamma * v_next - values[t]
        last = delta + gamma * lam * (0.0 if done else last)
        adv[t] = last
    ret = adv + values
    adv = (adv - adv.mean()) / (adv.std() + 1e-8)
    return torch.tensor(adv, dtype=torch.float32), torch.tensor(ret, dtype=torch.float32)


def main():
    args = parse()
    tmp = HERE / "weights-ppo.json"
    model = Policy(json.loads(Path(args.weights).read_text())["shape"])
    blob = load_blob(model, args.weights)
    value_ckpt = HERE / "value.pt"
    if value_ckpt.exists():
        model.value.load_state_dict(torch.load(value_ckpt))
    opt = torch.optim.Adam(model.parameters(), lr=args.lr)

    # The gate, same discipline as train.mjs: deterministic score on fixed
    # seeds decides what gets saved; training never overwrites the best.
    best_valid = float("-inf")
    save_blob(model, blob, tmp, "ppo working copy", None)
    _, best_valid = collect(tmp, args.room, 2, det=True, seeds="205,206")
    baseline = best_valid
    print(f"baseline validation {best_valid:.0f}")

    for it in range(1, args.iters + 1):
        save_blob(model, blob, tmp, "ppo working copy", None)
        steps, mean_ret = collect(tmp, args.room, args.episodes)
        obs = torch.tensor([s["o"] for s in steps], dtype=torch.float32)
        act = torch.tensor([s["a"] for s in steps], dtype=torch.long)
        old_lp = torch.tensor([s["lp"] for s in steps], dtype=torch.float32)
        with torch.no_grad():
            _, v = model(obs)
        adv, ret = gae(steps, v.numpy().astype(np.float64), args.gamma, args.lam)

        warm = it <= args.warmup
        for _ in range(args.epochs):
            logits, value = model(obs)
            dist = torch.distributions.Categorical(logits=logits)
            lp = dist.log_prob(act)
            ratio = torch.exp(lp - old_lp)
            surr = torch.min(ratio * adv,
                             torch.clamp(ratio, 1 - args.clip, 1 + args.clip) * adv)
            vloss = torch.nn.functional.mse_loss(value, ret)
            loss = vloss if warm else (-surr.mean() + 0.5 * vloss
                    - args.entropy * dist.entropy().mean())
            opt.zero_grad()
            loss.backward()
            nn.utils.clip_grad_norm_(model.parameters(), 0.5)
            opt.step()

        print(f"iter {it:3d}  steps {len(steps):6d}  meanReturn {mean_ret:7.0f}{'  [critic warmup]' if warm else ''}")
        if it % args.valid_every == 0 or it == args.iters:
            save_blob(model, blob, tmp, "ppo working copy", None)
            _, valid = collect(tmp, args.room, 2, det=True, seeds="205,206")
            mark = ""
            if valid > best_valid:
                best_valid = valid
                save_blob(model, blob, args.out, "PPO-trained policy", valid)
                torch.save(model.value.state_dict(), value_ckpt)
                mark = "  <- saved"
            print(f"          validation {valid:7.0f}{mark}")

    saved_any = best_valid > baseline
    print(f"best validation {best_valid:.0f}"
          + (f"; saved policy at {args.out}" if saved_any else "; nothing beat the baseline, output untouched"))


if __name__ == "__main__":
    main()
