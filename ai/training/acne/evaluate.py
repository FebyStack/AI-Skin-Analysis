"""Evaluate a trained acne model on the held-out split.

    .venv/bin/python -m ai.training.acne.evaluate                      # candidate
    .venv/bin/python -m ai.training.acne.evaluate --model-dir ai/models/acne/production

Reports macro-F1 AND ordinal MAE — severity is ordinal, so predicting 'severe'
for a 'very-severe' case (MAE 1) is better than predicting 'clear' (MAE 3), which
plain accuracy can't see. Writes the metrics into the model's model.json so the
registry/promote gate can read them.
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

from ai.training.acne.ingest import collect_all
from ai.training.acne.labels import ACNE_CLASSES
from ai.training.build_master import split_rows
from ai.training.dataset import LesionDataset  # generic (path,label) image dataset


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--model-dir", type=Path, default=Path("ai/models/acne/candidate"))
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
    mae = float(np.mean(np.abs(np.array(preds) - np.array(gts))))  # ordinal distance
    metrics = {"val_macro_f1": macro_f1, "acne_ordinal_mae": mae}

    meta["metrics"] = {**(meta.get("metrics") or {}), **metrics}
    (args.model_dir / "model.json").write_text(json.dumps(meta, indent=2))
    print(f"acne eval: macro_f1={macro_f1:.3f}  ordinal_MAE={mae:.3f}  (n={len(gts)})")
    print(f"classes: {ACNE_CLASSES}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
