"""Add the Kaggle "facial skin ageing" set (MIT) as dimension source `ageing`.

Every class there is 224x224 PNG from one packaging, so positives and negatives share a
distribution — the condition dimension/ingest.py sets for opting a source in via
DIMENSION_EXTRA_SOURCES. `clear_face` is the negative for all three dimensions.

    .venv/bin/python -m ai.training.multi.ingest_ageing RAW DEST
"""
from __future__ import annotations

import shutil
import sys
from pathlib import Path

SRC = "kaggle_siddheshbhatt_facial-skin-ageing/files/skin_ageing_symptoms"
POSITIVE = {"wrinkles": "wrinkles", "under-eye": "puffy_eyes", "pigmentation": "darkspots"}


def main(argv: list[str]) -> int:
    raw, dest = Path(argv[0]) / SRC, Path(argv[1])
    imgs = lambda d: [p for p in (raw / d).iterdir() if not p.name.startswith(".")]
    for dim, folder in POSITIVE.items():
        for label, src_dir in (("present", folder), ("absent", "clear_face")):
            out = dest / dim / "ageing" / label
            out.mkdir(parents=True, exist_ok=True)
            files = imgs(src_dir)
            for p in files:
                shutil.copyfile(p, out / p.name)
            print(f"  {dim:13} {label:8} {len(files)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
