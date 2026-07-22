"""Train the acne-severity analyzer.

    .venv/bin/python -m ai.training.acne.train_acne              # default 15 epochs
    .venv/bin/python -m ai.training.acne.train_acne --epochs 30

Pulls every labeled image under $DATASETS_DIR/acne/ (external datasets AND the
'scans' folder the backend export writes) via ingest.collect_all(), does a
grouped stratified split, and reuses the shared EfficientNet-B0 train loop
(ai.training.train.train_one). Output → ai/models/acne/candidate/.

Then evaluate + export to ONNX + promote (see the acne README).
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
from pathlib import Path

from ai.training.acne.ingest import collect_all, label_counts
from ai.training.acne.labels import ACNE_CLASSES
from ai.training.build_master import split_rows
from ai.training.dataset_guard import DatasetIntegrityError, preflight
from ai.training.train import train_one

CANDIDATE_DIR = Path("ai/models/acne/candidate")


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--epochs", type=int, default=15)
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--lr", type=float, default=1e-3)
    args = ap.parse_args(argv)

    # Fail loudly on an iCloud-corrupted dataset (evicted stubs / conflicted copies)
    # before spending hours training on a silently partial or duplicated set.
    try:
        preflight("acne")
    except DatasetIntegrityError as e:
        print(e)
        return 1

    rows = collect_all()
    if not rows:
        print(
            "No acne training data found under $DATASETS_DIR/acne/.\n"
            "  • drop an external dataset as acne/<source>/<severity>/*.jpg, and/or\n"
            "  • export labeled app scans:  POST /api/training/acne/export\n"
            "See ai/training/acne/README.md."
        )
        return 1

    counts = label_counts(rows)
    print(f"acne rows: {len(rows)}  by class: {counts}")
    present = [c for c in ACNE_CLASSES if counts.get(c, 0) > 0]
    if len(present) < 2:
        print("Need at least 2 severity classes with data to train. Add more labels.")
        return 1

    train_rows, val_rows, _test_rows = split_rows(rows, seed=args.seed)
    version = f"acne-{datetime.now(timezone.utc).strftime('%Y%m%d-%H%M%S')}"
    info = train_one(
        train_rows=train_rows,
        val_rows=val_rows,
        classes=ACNE_CLASSES,
        epochs=args.epochs,
        out_dir=CANDIDATE_DIR,
        seed=args.seed,
        lr=args.lr,
        version=version,
    )
    print(f"trained {version} → {CANDIDATE_DIR}  (val_macro_f1={info['val_macro_f1']:.3f})")
    print("Next: evaluate + export ONNX + promote (ai/training/acne/README.md).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
