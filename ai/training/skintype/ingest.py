"""Build skin-type training rows from labeled images on disk.

Folder-per-class under $DATASETS_DIR/skintype/ (relocatable):

    $DATASETS_DIR/skintype/<source>/<class>/*.jpg

where <class> is one of SKIN_TYPE_CLASSES (or an alias).

Returns rows [{path, label, group}] ready for ai.training.train.train_one.
Mirrors ai.training.acne.ingest — the 'scans' folder the backend export writes
lands here too, so external datasets + labeled app scans merge.
"""
from __future__ import annotations

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


def collect_all() -> list[dict]:
    base = skintype_dir()
    rows: list[dict] = []
    if not base.exists():
        return rows
    for child in sorted(base.iterdir()):
        if child.is_dir():
            rows += rows_from_folders(child.name)
    return rows


def label_counts(rows: list[dict]) -> dict[str, int]:
    counts = {c: 0 for c in SKIN_TYPE_CLASSES}
    for r in rows:
        counts[r["label"]] = counts.get(r["label"], 0) + 1
    return counts
