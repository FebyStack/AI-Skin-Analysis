"""Seed per-dimension training data from the multi-condition facial dataset.

Source: Kaggle shijo96john/facial-skin-acne-pigmentation-pores-wrinkles, already
extracted to ai/datasets/raw/_multi/dataset/<condition>/ (see ai/datasets/README.md).

Positives come from that dataset's condition folders. Negatives ("absent") come
from killa92's clear-skin `normal` faces — genuinely condition-free faces, which
is a far cleaner negative than borrowing another condition's folder (a wrinkled
face often also has redness).

    .venv/bin/python -m ai.training.dimension.fetch_multi
"""
from __future__ import annotations

from pathlib import Path

from ai.training.paths import datasets_dir

MULTI = Path("ai/datasets/raw/_multi/dataset")
KILLA = Path("ai/datasets/raw/killa92/skin_type_classification_dataset")
IMG_EXTS = {".jpg", ".jpeg", ".png", ".webp"}

# dimension -> source condition folders in the multi dataset
POSITIVE_SOURCES: dict[str, list[str]] = {
    "redness": ["Redness"],
    "wrinkles": ["wrinkles"],
    "pores": ["pores"],
    "pigmentation": ["pigmentation", "dark spots"],
}


def _images(d: Path) -> list[Path]:
    return sorted(p for p in d.iterdir() if p.suffix.lower() in IMG_EXTS) if d.exists() else []


def _link(src: Path, dst_dir: Path, name: str | None = None) -> None:
    dst_dir.mkdir(parents=True, exist_ok=True)
    link = dst_dir / (name or src.name)
    link.unlink(missing_ok=True)
    link.symlink_to(src.resolve())


def clear_faces() -> list[Path]:
    return [p for split in ("train", "valid", "test") for p in _images(KILLA / split / "normal")]


def main() -> None:
    if not MULTI.exists():
        print(f"Missing {MULTI} — download it first (see ai/datasets/README.md).")
        return
    negatives = clear_faces()
    if not negatives:
        print(f"Missing clear-skin negatives at {KILLA} — run fetch_killa92 first.")
        return

    for dim, folders in POSITIVE_SOURCES.items():
        pos = [p for f in folders for p in _images(MULTI / f)]
        if not pos:
            print(f"  {dim}: no source images, skipped")
            continue
        base = datasets_dir() / dim / "multi"
        for p in pos:
            _link(p, base / "present")
        # Balance negatives against positives so the model can't win by always
        # predicting the majority class.
        for p in negatives[: len(pos)]:
            _link(p, base / "absent", name=f"clear_{p.name}")
        print(f"  {dim}: present={len(pos)} absent={min(len(negatives), len(pos))}")
    print("Done. Train one with: .venv/bin/python -m ai.training.dimension.train_dimension --dim redness")


if __name__ == "__main__":
    main()
