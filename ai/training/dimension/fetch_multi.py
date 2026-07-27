"""Seed per-dimension training data from the multi-condition facial dataset.

Source: Kaggle shijo96john/facial-skin-acne-pigmentation-pores-wrinkles, already
extracted to ai/datasets/raw/_multi/dataset/<condition>/ (see ai/datasets/README.md).

Negatives are deliberately drawn MOSTLY from the same dataset's *other* condition
folders, not only from clear faces. Using clear faces alone made positives and
negatives come from different sources, so the model scored ~0.99 by learning
"which dataset is this image from" instead of the condition — a shortcut that
vanishes in clinic use, where every image comes from one camera. Mixing in
same-source negatives removes that cue; the cost is some label noise (a wrinkled
face may also have redness), which is far less damaging than source leakage.
Expect honest scores (~0.7-0.85), not 0.99.

    .venv/bin/python -m ai.training.dimension.fetch_multi
"""
from __future__ import annotations

import random
import shutil
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


SAME_SOURCE_NEG_SHARE = 0.7  # rest are clear faces (true negatives, other source)


def main() -> None:
    if not MULTI.exists():
        print(f"Missing {MULTI} — download it first (see ai/datasets/README.md).")
        return
    clear = clear_faces()
    if not clear:
        print(f"Missing clear-skin negatives at {KILLA} — run fetch_killa92 first.")
        return

    rng = random.Random(0)  # deterministic arrangement
    all_folders = sorted(p.name for p in MULTI.iterdir() if p.is_dir())

    for dim, folders in POSITIVE_SOURCES.items():
        pos = [p for f in folders for p in _images(MULTI / f)]
        if not pos:
            print(f"  {dim}: no source images, skipped")
            continue

        # Same-source negatives: this dataset's OTHER condition folders. Both
        # classes then share a capture pipeline, so the model can't separate them
        # by source and has to look at the skin.
        others = [p for f in all_folders if f not in folders for p in _images(MULTI / f)]
        rng.shuffle(others)
        want_same = min(len(others), int(len(pos) * SAME_SOURCE_NEG_SHARE))
        want_clear = min(len(clear), len(pos) - want_same)
        neg_same, neg_clear = others[:want_same], clear[:want_clear]

        base = datasets_dir() / dim / "multi"
        shutil.rmtree(base, ignore_errors=True)  # drop any earlier arrangement
        for p in pos:
            _link(p, base / "present")
        for p in neg_same:
            _link(p, base / "absent", name=f"other_{p.parent.name.replace(' ', '_')}_{p.name}")
        for p in neg_clear:
            _link(p, base / "absent", name=f"clear_{p.name}")
        print(f"  {dim}: present={len(pos)} absent={len(neg_same)}+{len(neg_clear)} (same-source+clear)")
    print("Done. Train: make retrain-dims  (expect ~0.7-0.85, not 0.99 — that was source leakage)")


if __name__ == "__main__":
    main()
