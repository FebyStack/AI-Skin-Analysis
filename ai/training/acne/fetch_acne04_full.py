"""Fetch the FULL ACNE04 set (Kaggle, ~1.1GB) — the only source with very-severe.

The plain `kaggle datasets download` restarts from zero when the connection drops,
which never completes on a slow link. This uses curl with `-C -` (resume) and
retries, so re-running continues where it stopped.

    .venv/bin/python -m ai.training.acne.fetch_acne04_full        # download+arrange
    .venv/bin/python -m ai.training.acne.fetch_acne04_full --arrange-only

Filenames encode the Hayashi level (levle0_*.jpg … levle3_*.jpg); mapping matches
fetch_acne04: 0=mild, 1=moderate, 2=severe, 3=very-severe (ACNE04 has no 'clear').
Images already present under $DATASETS_DIR/acne (by filename stem) are skipped, so
this only adds what the smaller subsets lack.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import tempfile
import zipfile
from pathlib import Path

from ai.training.acne.ingest import acne_dir

REF = "lexuanhieu131297/acne-severity-classification"
URL = f"https://www.kaggle.com/api/v1/datasets/download/{REF}"
RAW = Path("ai/datasets/raw/acne04full")
ZIP = RAW / "acne04full.zip"
IMG_EXTS = {".jpg", ".jpeg", ".png", ".webp"}
LEVEL_TO_LABEL = {"0": "mild", "1": "moderate", "2": "severe", "3": "very-severe"}
LEVEL_RE = re.compile(r"levle(\d)_", re.I)


def download() -> bool:
    """Resumable download. Returns True when the zip looks complete."""
    creds = json.loads((Path.home() / ".kaggle" / "kaggle.json").read_text())
    RAW.mkdir(parents=True, exist_ok=True)
    # Pass credentials via a 0600 config file so the key never lands in `ps` output.
    with tempfile.NamedTemporaryFile("w", suffix=".curlrc", delete=False) as cfg:
        cfg.write(f'user = "{creds["username"]}:{creds["key"]}"\n')
        cfg_path = cfg.name
    os.chmod(cfg_path, 0o600)
    try:
        print(f"Downloading {REF} (resumable) → {ZIP}")
        r = subprocess.run(
            ["curl", "-K", cfg_path, "-L", "-C", "-", "--retry", "20", "--retry-delay", "5",
             "--retry-all-errors", "--connect-timeout", "30", "-o", str(ZIP), URL],
            check=False,
        )
        if r.returncode != 0:
            print(f"curl exited {r.returncode} — re-run this command to resume.")
            return False
    finally:
        os.unlink(cfg_path)
    if not zipfile.is_zipfile(ZIP):
        print("Downloaded file isn't a complete zip yet — re-run to resume.")
        return False
    return True


def arrange() -> None:
    # Works from an existing extraction even after the 1GB zip is deleted.
    extract_dir = RAW / "extracted"
    if not extract_dir.exists():
        if not zipfile.is_zipfile(ZIP):
            print(f"No complete zip at {ZIP} and nothing extracted. Run without --arrange-only.")
            return
        print("Extracting …")
        with zipfile.ZipFile(ZIP) as z:
            z.extractall(extract_dir)

    base = acne_dir()
    existing = {p.stem for p in base.rglob("*") if p.suffix.lower() in IMG_EXTS}
    print(f"already have {len(existing)} acne images")

    added: dict[str, int] = {}
    for img in extract_dir.rglob("*"):
        if img.suffix.lower() not in IMG_EXTS or img.stem in existing:
            continue
        m = LEVEL_RE.search(img.name)
        if not m:
            continue
        label = LEVEL_TO_LABEL.get(m.group(1))
        if not label:
            continue
        dst = base / "acne04full" / label
        dst.mkdir(parents=True, exist_ok=True)
        link = dst / img.name
        if not link.exists():
            link.symlink_to(img.resolve())
        existing.add(img.stem)
        added[label] = added.get(label, 0) + 1
    print(f"added (deduped): {added or 'nothing new'}")
    print("Now retrain:  caffeinate -i make retrain-acne")


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--arrange-only", action="store_true")
    args = ap.parse_args(argv)
    if not args.arrange_only and not download():
        return 1
    arrange()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
