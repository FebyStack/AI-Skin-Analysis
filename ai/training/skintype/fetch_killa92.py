"""Fetch the killa92 facial skin-type dataset (Kaggle) into the ingest layout.

Source: kaggle datasets / killa92/facial-skin-analysis-and-type-classification
Requires Kaggle API credentials at ~/.kaggle/kaggle.json (username + key).

Downloads to ai/datasets/raw/killa92/, then symlinks each class's train+valid+test
images into $DATASETS_DIR/skintype/killa92/<class>/ where ingest reads them.
Also links up to 150 'normal' faces into $DATASETS_DIR/acne/clearskin/clear/ so the
acne model gains a 'clear' (no-acne) class from full-face clear skin.

Run:  .venv/bin/python -m ai.training.skintype.fetch_killa92
"""
from __future__ import annotations

from pathlib import Path

from ai.training.paths import datasets_dir
from ai.training.skintype.ingest import skintype_dir
from ai.training.skintype.labels import SKIN_TYPE_CLASSES

REF = "killa92/facial-skin-analysis-and-type-classification"
IMG_EXTS = {".jpg", ".jpeg", ".png", ".webp"}
CLEAR_CAP = 150  # keep acne 'clear' near the ~100/class acne levels


def _link(src: Path, dst_dir: Path) -> None:
    dst_dir.mkdir(parents=True, exist_ok=True)
    (dst_dir / src.name).unlink(missing_ok=True)
    (dst_dir / src.name).symlink_to(src.resolve())


def main() -> None:
    raw = Path("ai/datasets/raw/killa92")
    raw.mkdir(parents=True, exist_ok=True)
    from kaggle.api.kaggle_api_extended import KaggleApi

    api = KaggleApi()
    api.authenticate()
    print(f"Downloading {REF} → {raw} …")
    api.dataset_download_files(REF, path=str(raw), unzip=True, quiet=False)

    base = raw / "skin_type_classification_dataset"
    for cls in SKIN_TYPE_CLASSES:
        imgs = [
            p
            for split in ("train", "valid", "test")
            for p in (base / split / cls).glob("*")
            if p.suffix.lower() in IMG_EXTS
        ]
        for p in imgs:
            _link(p, skintype_dir() / "killa92" / cls)
        print(f"  skintype/{cls}: {len(imgs)}")

    normal = [
        p
        for split in ("train", "valid", "test")
        for p in (base / split / "normal").glob("*")
        if p.suffix.lower() in IMG_EXTS
    ][:CLEAR_CAP]
    for p in normal:
        _link(p, datasets_dir() / "acne" / "clearskin" / "clear")
    print(f"  acne clear (from normal): {len(normal)}")
    print("Done.")


if __name__ == "__main__":
    main()
