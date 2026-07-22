"""Fetch the ACNE04 severity dataset (public HF mirror) into the ingest layout.

Source: https://huggingface.co/datasets/ManuelHettich/acne04  (public, no login)
ACNE04 grades images into 4 Hayashi severity levels — there is NO 'clear' class
(every image has acne), so we map grade folders to mild..very-severe, NOT clear:

    acne0_1024 -> mild        acne2_1024 -> severe
    acne1_1024 -> moderate    acne3_1024 -> very-severe

Downloads to ai/datasets/raw/acne04/, then symlinks images into
$DATASETS_DIR/acne/acne04/<label>/ where ai.training.acne.ingest reads them.
'clear' examples come later from clinician-labeled app scans (export loop).

Run:  .venv/bin/python -m ai.training.acne.fetch_acne04
"""
from __future__ import annotations

from pathlib import Path

from huggingface_hub import snapshot_download

from ai.training.acne.ingest import acne_dir

REPO = "ManuelHettich/acne04"
# HF grade folder -> canonical acne label (see module docstring).
FOLDER_TO_LABEL = {
    "acne0_1024": "mild",
    "acne1_1024": "moderate",
    "acne2_1024": "severe",
    "acne3_1024": "very-severe",
}
IMG_EXTS = {".jpg", ".jpeg", ".png", ".webp"}


def main() -> None:
    raw = Path("ai/datasets/raw/acne04")
    raw.mkdir(parents=True, exist_ok=True)
    print(f"Downloading {REPO} grade folders → {raw} …")
    snapshot_download(
        repo_id=REPO,
        repo_type="dataset",
        local_dir=str(raw),
        allow_patterns=[f"{f}/*" for f in FOLDER_TO_LABEL],
    )

    out_base = acne_dir() / "acne04"
    total = 0
    for folder, label in FOLDER_TO_LABEL.items():
        src = raw / folder
        if not src.exists():
            print(f"  ! missing {src} — skipped")
            continue
        dst = out_base / label
        dst.mkdir(parents=True, exist_ok=True)
        n = 0
        for img in src.iterdir():
            if img.suffix.lower() in IMG_EXTS:
                link = dst / img.name
                if not link.exists():
                    link.symlink_to(img.resolve())
                n += 1
        total += n
        print(f"  {folder:>12} → {label:<12} {n} images")
    print(f"Done. {total} images linked under {out_base}")


if __name__ == "__main__":
    main()
