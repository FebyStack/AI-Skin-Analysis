"""Train the skin-type analyzer.

    .venv/bin/python -m ai.training.skintype.train_skintype              # default 15 epochs
    .venv/bin/python -m ai.training.skintype.train_skintype --epochs 30

Pulls every labeled image under $DATASETS_DIR/skintype/ (external datasets AND
the 'scans' folder the backend export writes) via ingest.collect_all(), does a
grouped stratified split, and reuses the shared EfficientNet-B0 train loop.
Output → ai/models/skintype/candidate/. Then evaluate + export ONNX (see README).
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
from pathlib import Path

from ai.training.skintype.ingest import collect_all, label_counts
from ai.training.skintype.labels import SKIN_TYPE_CLASSES
from ai.training.build_master import split_rows
from ai.training.dataset_guard import DatasetIntegrityError, preflight
from ai.training.train import train_one

CANDIDATE_DIR = Path("ai/models/skintype/candidate")


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--epochs", type=int, default=15)
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--lr", type=float, default=1e-3)
    args = ap.parse_args(argv)

    # Fail loudly on an iCloud-corrupted dataset (evicted stubs / conflicted copies)
    # before spending hours training on a silently partial or duplicated set.
    try:
        preflight("skintype")
    except DatasetIntegrityError as e:
        print(e)
        return 1

    rows = collect_all()
    if not rows:
        print(
            "No skin-type training data found under $DATASETS_DIR/skintype/.\n"
            "  • fetch a dataset:  .venv/bin/python -m ai.training.skintype.fetch_killa92\n"
            "  • and/or export labeled app scans:  POST /api/training/skintype/export\n"
            "See ai/training/skintype/README.md."
        )
        return 1

    counts = label_counts(rows)
    print(f"skin-type rows: {len(rows)}  by class: {counts}")
    present = [c for c in SKIN_TYPE_CLASSES if counts.get(c, 0) > 0]
    if len(present) < 2:
        print("Need at least 2 classes with data to train. Add more labels.")
        return 1

    train_rows, val_rows, _test_rows = split_rows(rows, seed=args.seed)
    version = f"skintype-{datetime.now(timezone.utc).strftime('%Y%m%d-%H%M%S')}"
    info = train_one(
        train_rows=train_rows,
        val_rows=val_rows,
        classes=SKIN_TYPE_CLASSES,
        epochs=args.epochs,
        out_dir=CANDIDATE_DIR,
        seed=args.seed,
        lr=args.lr,
        version=version,
    )
    print(f"trained {version} → {CANDIDATE_DIR}  (val_macro_f1={info['val_macro_f1']:.3f})")
    print("Next: evaluate + export ONNX (ai/training/skintype/README.md).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
