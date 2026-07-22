"""Build skin-type training rows from labeled images on disk.

Two supported layouts, both under $DATASETS_DIR/skintype/ (relocatable):

  1. Folder-per-class:  $DATASETS_DIR/skintype/<source>/<class>/*.jpg
     where <class> is one of SKIN_TYPE_CLASSES (or an alias).
  2. CSV:  $DATASETS_DIR/skintype/<source>.csv  with columns: path,label

Returns rows [{path, label, group}] ready for ai.training.train.train_one.
Mirrors ai.training.acne.ingest — the 'scans' folder the backend export writes
lands here too, so external datasets + labeled app scans merge.
"""
from __future__ import annotations

import csv
from pathlib import Path

from ai.training.paths import datasets_dir
from ai.training.skintype.labels import SKIN_TYPE_CLASSES, normalize_skin_type

IMG_EXTS = {".jpg", ".jpeg", ".png", ".webp"}


def skintype_dir() -> Path:
    return datasets_dir() / "skintype"


def rows_from_folders(source: str) -> list[dict]:
    base = skintype_dir() / source
    rows: list[dict] = []
    if not base.exists():
        return rows
    for label_dir in sorted(p for p in base.iterdir() if p.is_dir()):
        label = normalize_skin_type(label_dir.name)
        if label is None:
            continue
        for img in label_dir.iterdir():
            if img.suffix.lower() in IMG_EXTS:
                rows.append({"path": str(img), "label": label, "group": img.stem})
    return rows


def rows_from_csv(source: str) -> list[dict]:
    csv_path = skintype_dir() / f"{source}.csv"
    rows: list[dict] = []
    if not csv_path.exists():
        return rows
    with open(csv_path, newline="") as f:
        for r in csv.DictReader(f):
            label = normalize_skin_type(r.get("label", ""))
            path = r.get("path", "")
            if label and path:
                rows.append({"path": path, "label": label, "group": Path(path).stem})
    return rows


def collect_all() -> list[dict]:
    base = skintype_dir()
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
    counts = {c: 0 for c in SKIN_TYPE_CLASSES}
    for r in rows:
        counts[r["label"]] = counts.get(r["label"], 0) + 1
    return counts
