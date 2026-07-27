"""Evaluate a trained face-dimension model on its held-out split.

    .venv/bin/python -m ai.training.dimension.evaluate --dim redness

Reports macro-F1 + accuracy, writes them into model.json, and appends the run to
ai/models/<dim>/history.jsonl (the before/after history the Training tab charts).
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
import torch
from sklearn.metrics import f1_score
from torch.utils.data import DataLoader
from torchvision.models import efficientnet_b0

from ai.training.build_master import split_rows
from ai.training.dataset import LesionDataset
from ai.training.dimension.ingest import collect_all, label_counts
from ai.training.dimension.labels import DIMENSION_CLASSES
from ai.training.history import append_run


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dim", required=True, choices=sorted(DIMENSION_CLASSES))
    ap.add_argument("--seed", type=int, default=0)
    args = ap.parse_args(argv)

    dim = args.dim
    model_dir = Path(f"ai/models/{dim}/candidate")
    meta = json.loads((model_dir / "model.json").read_text())
    classes = meta["classes"]
    net = efficientnet_b0(num_classes=len(classes))
    net.load_state_dict(torch.load(model_dir / "current.pt", map_location="cpu", weights_only=True))
    net.eval()

    all_rows = collect_all(dim)
    _train, _val, test_rows = split_rows(all_rows, seed=args.seed)
    if not test_rows:
        print("No test rows — need more data to evaluate.")
        return 1

    dl = DataLoader(LesionDataset(test_rows, classes, training=False), batch_size=32)
    preds, gts = [], []
    with torch.no_grad():
        for x, y in dl:
            preds += net(x).argmax(1).tolist()
            gts += y.tolist()

    macro_f1 = float(f1_score(gts, preds, average="macro", zero_division=0))
    accuracy = float(np.mean(np.array(preds) == np.array(gts)))
    metrics = {"val_macro_f1": macro_f1, f"{dim}_accuracy": accuracy}

    meta["metrics"] = {**(meta.get("metrics") or {}), **metrics}
    (model_dir / "model.json").write_text(json.dumps(meta, indent=2))
    append_run(model_dir.parent, meta.get("version", "candidate"), metrics, label_counts(dim, all_rows))
    print(f"{dim} eval: macro_f1={macro_f1:.3f}  accuracy={accuracy:.3f}  (n={len(gts)})")
    print(f"classes: {classes}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
