"""Build the master dataset: dedup (Task 2) BEFORE splitting, then patient/lesion-GROUPED
stratified split so no patient leaks across train/val/test. Emits manifest.json (sha256 of the
sorted kept-path list) — the frozen test set is identified by this hash and never trained on."""
import hashlib
import json
from collections import defaultdict
from pathlib import Path
import numpy as np
from sklearn.model_selection import StratifiedGroupKFold
from ai.training.paths import master_dir

def split_rows(rows: list[dict], seed: int = 0) -> tuple[list[dict], list[dict], list[dict]]:
    """rows need {path, label, group}. Returns (train, val, test) ≈ 70/15/15, groups disjoint."""
    X = np.arange(len(rows))
    y = np.array([r["label"] for r in rows])
    groups = np.array([r["group"] for r in rows])
    # test = 1 fold of 7; val = 1 fold of the remaining 6
    sgkf = StratifiedGroupKFold(n_splits=7, shuffle=True, random_state=seed)
    train_val_idx, test_idx = next(sgkf.split(X, y, groups))
    tv = [rows[i] for i in train_val_idx]
    Xv = np.arange(len(tv)); yv = np.array([r["label"] for r in tv]); gv = np.array([r["group"] for r in tv])
    sgkf2 = StratifiedGroupKFold(n_splits=6, shuffle=True, random_state=seed)
    tr_idx, val_idx = next(sgkf2.split(Xv, yv, gv))
    return [tv[i] for i in tr_idx], [tv[i] for i in val_idx], [rows[i] for i in test_idx]

def manifest_hash(rows: list[dict]) -> str:
    joined = "\n".join(sorted(r["path"] for r in rows))
    return hashlib.sha256(joined.encode()).hexdigest()

def write_master(kept_rows: list[dict], seed: int = 0, out: Path | None = None) -> dict:
    out = out or master_dir()
    out.mkdir(parents=True, exist_ok=True)
    train, val, test = split_rows(kept_rows, seed)
    for name, rows in (("train", train), ("val", val), ("test", test)):
        (out / f"{name}.json").write_text(json.dumps(rows, indent=2))
    meta = {"seed": seed, "counts": {"train": len(train), "val": len(val), "test": len(test)},
            "manifest_sha256": manifest_hash(kept_rows)}
    (out / "manifest.json").write_text(json.dumps(meta, indent=2))
    return meta
