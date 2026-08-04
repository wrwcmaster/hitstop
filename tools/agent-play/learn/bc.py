"""Behaviour cloning: learn the human's move, then let PPO refine it.

    python tools/agent-play/learn/bc.py --demo demo.jsonl --out bc-weights.json

Dev tooling only — the game ships zero runtime dependencies and never
imports this. Shares ppo.py's Policy and blob format, so anything that
can run weights.json can run the result.

Why cloning and not more reward: the corner is a LOCAL OPTIMUM. Under
the current reward hit-and-run scores higher, and PPO still will not go
there, because every route out of the corner passes through worse play
first. Gradients do not cross valleys; demonstrations start you on the
far side. This trains the same 151-24-18 policy on (observation ->
action) pairs harvested from a human tape (demo.mjs) with plain
cross-entropy — no reward, no rollouts, no exploration.

What it deliberately does NOT do: touch weights.json. Cloning optimises
agreement with a human, which is not the same as winning, and the two
can part company (a clone that mimics the style and loses the fight is
a real outcome). The result lands in its own file and has to earn the
throne through the same validation the trainer uses.
"""
import argparse
import json
from pathlib import Path

import numpy as np
import torch
import torch.nn as nn

from ppo import Policy, load_blob, save_blob

HERE = Path(__file__).parent


def parse():
    ap = argparse.ArgumentParser()
    ap.add_argument("--demo", default=str(HERE / "demo.jsonl"))
    ap.add_argument("--weights", default=str(HERE / "weights.json"),
                    help="shape donor + starting point; never written to")
    ap.add_argument("--out", default=str(HERE / "bc-weights.json"))
    ap.add_argument("--epochs", type=int, default=400)
    ap.add_argument("--lr", type=float, default=1e-3)
    ap.add_argument("--decay", type=float, default=1e-4)
    ap.add_argument("--val", type=float, default=0.1)
    ap.add_argument("--scratch", action="store_true",
                    help="start from random weights instead of the champion")
    return ap.parse_args()


def main():
    args = parse()
    rows = [json.loads(l) for l in Path(args.demo).read_text().splitlines() if l.strip()]
    if not rows:
        raise SystemExit(f"no pairs in {args.demo}")
    X = torch.tensor(np.array([r["o"] for r in rows], dtype=np.float32))
    y = torch.tensor(np.array([r["a"] for r in rows], dtype=np.int64))

    blob = json.loads(Path(args.weights).read_text())
    model = Policy(blob["shape"])
    if not args.scratch:
        load_blob(model, args.weights)

    # A held-out slice decides when to stop. 1,952 pairs against 4,098
    # parameters is thin enough that the net can memorise the tape, and a
    # memorised tape is a policy that has learned this fight rather than
    # this STYLE.
    n = len(rows)
    cut = int(n * (1 - args.val))
    perm = torch.randperm(n, generator=torch.Generator().manual_seed(7))
    tr, va = perm[:cut], perm[cut:]

    opt = torch.optim.Adam(model.parameters(), lr=args.lr, weight_decay=args.decay)
    lossf = nn.CrossEntropyLoss()
    best = (0.0, None, 0)

    for ep in range(1, args.epochs + 1):
        model.train()
        logits, _ = model(X[tr])
        loss = lossf(logits, y[tr])
        opt.zero_grad()
        loss.backward()
        opt.step()

        model.eval()
        with torch.no_grad():
            vl, _ = model(X[va])
            acc = (vl.argmax(1) == y[va]).float().mean().item()
            tl, _ = model(X[tr])
            tacc = (tl.argmax(1) == y[tr]).float().mean().item()
        if acc > best[0]:
            best = (acc, {k: v.clone() for k, v in model.state_dict().items()}, ep)
        if ep % 50 == 0 or ep == 1:
            print(f"epoch {ep:4d}  loss {loss.item():.3f}  train {tacc * 100:5.1f}%  val {acc * 100:5.1f}%")

    acc, state, ep = best
    model.load_state_dict(state)
    save_blob(model, blob, args.out, f"behaviour-cloned from {Path(args.demo).name}", None)
    # A baseline worth printing: always guessing the commonest move.
    major = float(torch.bincount(y).max()) / n
    print(f"\nbest val {acc * 100:.1f}% at epoch {ep} (majority-class baseline {major * 100:.1f}%)")
    print(f"saved {args.out} - NOT weights.json; it has to win the gate first")


if __name__ == "__main__":
    main()
