"""Evaluate the multi-head face model on the held-out split (per task).

    .venv/bin/python -m ai.training.multi.evaluate

Writes metrics into model.json and appends the run to ai/models/face/history.jsonl
so the Training tab charts it like the single-task models.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import torch
from torch.utils.data import DataLoader

from ai.training.build_master import split_rows
from ai.training.history import append_run
from ai.training.multi.model import MultiHeadNet
from ai.training.multi.tasks import TASKS, MultiTaskDataset, collect_rows, task_counts
from ai.training.multi.train_multi import _evaluate
from ai.training.train import _device

MODEL_DIR = Path("ai/models/face/candidate")


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--seed", type=int, default=0)
    args = ap.parse_args(argv)

    meta = json.loads((MODEL_DIR / "model.json").read_text())
    dev = _device()
    net = MultiHeadNet(pretrained=False).to(dev)
    net.load_state_dict(torch.load(MODEL_DIR / "current.pt", map_location=dev, weights_only=True))

    all_rows = collect_rows()
    _train, _val, test_rows = split_rows(all_rows, seed=args.seed)
    if not test_rows:
        print("No test rows — need more data to evaluate.")
        return 1

    scores = _evaluate(net, DataLoader(MultiTaskDataset(test_rows, False), batch_size=32), dev)
    metrics = {"val_macro_f1": scores["mean"],
               **{f"val_macro_f1_{t}": scores[t] for t in TASKS}}
    meta["metrics"] = {**(meta.get("metrics") or {}), **metrics}
    (MODEL_DIR / "model.json").write_text(json.dumps(meta, indent=2))
    append_run(MODEL_DIR.parent, meta.get("version", "candidate"), metrics, task_counts(all_rows))
    print(f"face eval (n={len(test_rows)}): mean macro_f1={scores['mean']:.3f}  " +
          "  ".join(f"{t}={scores[t]:.3f}" for t in TASKS))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
