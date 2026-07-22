"""Evaluate a trained skin-type model on the held-out split.

    .venv/bin/python -m ai.training.skintype.evaluate                      # candidate
    .venv/bin/python -m ai.training.skintype.evaluate --model-dir ai/models/skintype/production

Skin type is categorical (no order), so this reports accuracy + macro-F1 (no MAE).
Writes the metrics into the model's model.json for the registry/promote gate.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
import torch
from torch.utils.data import DataLoader
from torchvision.models import efficientnet_b0
from sklearn.metrics import f1_score

from ai.training.skintype.ingest import collect_all
from ai.training.skintype.labels import SKIN_TYPE_CLASSES
from ai.training.build_master import split_rows
from ai.training.dataset import LesionDataset  # generic (path,label) image dataset


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--model-dir", type=Path, default=Path("ai/models/skintype/candidate"))
    ap.add_argument("--seed", type=int, default=0)
    args = ap.parse_args(argv)

    meta = json.loads((args.model_dir / "model.json").read_text())
    classes = meta["classes"]
    net = efficientnet_b0(num_classes=len(classes))
    net.load_state_dict(torch.load(args.model_dir / "current.pt", map_location="cpu", weights_only=True))
    net.eval()

    _train, _val, test_rows = split_rows(collect_all(), seed=args.seed)
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
    metrics = {"val_macro_f1": macro_f1, "skintype_accuracy": accuracy}

    meta["metrics"] = {**(meta.get("metrics") or {}), **metrics}
    (args.model_dir / "model.json").write_text(json.dumps(meta, indent=2))
    print(f"skin-type eval: macro_f1={macro_f1:.3f}  accuracy={accuracy:.3f}  (n={len(gts)})")
    print(f"classes: {SKIN_TYPE_CLASSES}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
