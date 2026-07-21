"""Build acne training rows from labeled images on disk.

Two supported layouts, both under $DATASETS_DIR/acne/ (relocatable):

  1. Folder-per-severity (external datasets AND exported app scans both land here):
       $DATASETS_DIR/acne/<source>/<label>/*.jpg
     where <label> is one of ACNE_CLASSES (or an alias, e.g. "0".."4").

  2. CSV:  $DATASETS_DIR/acne/<source>.csv  with columns: path,label

Returns rows [{path, label, group}] ready for ai.training.train.train_one.
group defaults to the file stem so patient/image grouping can be layered later.
"""
from __future__ import annotations

import csv
from pathlib import Path

from ai.training.paths import datasets_dir
from ai.training.acne.labels import ACNE_CLASSES, normalize_acne_label

IMG_EXTS = {".jpg", ".jpeg", ".png", ".webp"}


def acne_dir() -> Path:
    return datasets_dir() / "acne"


def rows_from_folders(source: str) -> list[dict]:
    """$DATASETS_DIR/acne/<source>/<label>/*.jpg → rows."""
    base = acne_dir() / source
    rows: list[dict] = []
    if not base.exists():
        return rows
    for label_dir in sorted(p for p in base.iterdir() if p.is_dir()):
        label = normalize_acne_label(label_dir.name)
        if label is None:
            continue
        for img in label_dir.iterdir():
            if img.suffix.lower() in IMG_EXTS:
                rows.append({"path": str(img), "label": label, "group": img.stem})
    return rows


def rows_from_csv(source: str) -> list[dict]:
    """$DATASETS_DIR/acne/<source>.csv (path,label) → rows."""
    csv_path = acne_dir() / f"{source}.csv"
    rows: list[dict] = []
    if not csv_path.exists():
        return rows
    with open(csv_path, newline="") as f:
        for r in csv.DictReader(f):
            label = normalize_acne_label(r.get("label", ""))
            path = r.get("path", "")
            if label and path:
                rows.append({"path": path, "label": label, "group": Path(path).stem})
    return rows


def collect_all() -> list[dict]:
    """Every folder-source + every CSV under $DATASETS_DIR/acne/. Includes the
    'scans' folder that the backend export writes to — external + app data merged."""
    base = acne_dir()
    rows: list[dict] = []
    if not base.exists():
        return rows
    for child in sorted(base.iterdir()):
        if child.is_dir():
            rows += rows_from_folders(child.name)
        elif child.suffix.lower() == ".csv":
            rows += rows_from_csv(child.stem)
    return rows


def label_counts(rows: list[dict]) -> dict[str, int]:
    counts = {c: 0 for c in ACNE_CLASSES}
    for r in rows:
        counts[r["label"]] = counts.get(r["label"], 0) + 1
    return counts
