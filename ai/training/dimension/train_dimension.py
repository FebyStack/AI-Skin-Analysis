"""Train a face-dimension model (redness, wrinkles, pores, pigmentation, ...).

    .venv/bin/python -m ai.training.dimension.train_dimension --dim redness
    .venv/bin/python -m ai.training.dimension.train_dimension --dim wrinkles --epochs 12

Reads every labeled image under $DATASETS_DIR/<dim>/ (external datasets AND the
'scans' folder the app export writes), then reuses the shared EfficientNet-B0
loop. Output → ai/models/<dim>/candidate/. Then evaluate + export_onnx.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
from pathlib import Path

from ai.training.build_master import split_rows
from ai.training.dimension.ingest import collect_all, label_counts
from ai.training.dimension.labels import DIMENSION_CLASSES, classes_for
from ai.training.train import train_one


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dim", required=True, choices=sorted(DIMENSION_CLASSES))
    ap.add_argument("--epochs", type=int, default=12)
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--lr", type=float, default=1e-3)
    args = ap.parse_args(argv)

    dim = args.dim
    classes = classes_for(dim)
    rows = collect_all(dim)
    if not rows:
        print(
            f"No training data under $DATASETS_DIR/{dim}/.\n"
            f"  • seed from the multi-condition dataset:  "
            f".venv/bin/python -m ai.training.dimension.fetch_multi\n"
            f"  • and/or export labeled app scans:  POST /api/training/{dim}/export"
        )
        return 1

    counts = label_counts(dim, rows)
    print(f"{dim} rows: {len(rows)}  by class: {counts}")
    if sum(1 for c in classes if counts.get(c, 0) > 0) < 2:
        print("Need at least 2 classes with data to train.")
        return 1

    train_rows, val_rows, _test = split_rows(rows, seed=args.seed)
    version = f"{dim}-{datetime.now(timezone.utc).strftime('%Y%m%d-%H%M%S')}"
    info = train_one(
        train_rows=train_rows,
        val_rows=val_rows,
        classes=classes,
        epochs=args.epochs,
        out_dir=Path(f"ai/models/{dim}/candidate"),
        seed=args.seed,
        lr=args.lr,
        version=version,
        face=True,  # upright faces — no vertical flip
    )
    print(f"trained {version} (val_macro_f1={info['val_macro_f1']:.3f})")
    print(f"Next: evaluate + export_onnx --dim {dim}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
