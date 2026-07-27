"""Build training rows for any face dimension from labeled images on disk.

Layout (same shape as acne/skintype, parameterized by dimension):

    $DATASETS_DIR/<dimension>/<source>/<class>/*.jpg
    $DATASETS_DIR/<dimension>/scans/<class>/<scanId>.jpg   # clinician-labeled app scans

Returns rows [{path, label, group}] for ai.training.train.train_one.
"""
from __future__ import annotations

from ai.training.paths import datasets_dir
from ai.training.dimension.labels import classes_for, normalize_label

IMG_EXTS = {".jpg", ".jpeg", ".png", ".webp"}


def dimension_dir(dimension: str) -> Path:
    return datasets_dir() / dimension


def rows_from_folders(dimension: str, source: str) -> list[dict]:
    base = dimension_dir(dimension) / source
    rows: list[dict] = []
    if not base.exists():
        return rows
    for label_dir in sorted(p for p in base.iterdir() if p.is_dir()):
        label = normalize_label(dimension, label_dir.name)
        if label is None:
            continue
        for img in label_dir.iterdir():
            if img.suffix.lower() in IMG_EXTS:
                rows.append({"path": str(img), "label": label, "group": img.stem})
    return rows


def collect_all(dimension: str) -> list[dict]:
    base = dimension_dir(dimension)
    rows: list[dict] = []
    if not base.exists():
        return rows
    for child in sorted(base.iterdir()):
        if child.is_dir():
            rows += rows_from_folders(dimension, child.name)
    return rows


def label_counts(dimension: str, rows: list[dict]) -> dict[str, int]:
    counts = {c: 0 for c in classes_for(dimension)}
    for r in rows:
        counts[r["label"]] = counts.get(r["label"], 0) + 1
    return counts
