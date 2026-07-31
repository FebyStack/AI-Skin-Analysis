"""Fetch external face datasets for the severity dimensions.

Run:  make fetch-dimension-datasets

WHAT THIS CAN AND CANNOT DO
---------------------------
No public dataset grades these dimensions on the none/mild/moderate/severe scale
the app uses. Everything available is presence/absence ("this face has redness"),
so nothing downloaded here can be dropped straight into a training folder — the
severity is simply not known.

What these images ARE good for: they are real faces with a *consistent capture
rig*, which is the scarce ingredient. The clinic has ~31 graded rows and almost
no moderate/severe examples. Grading these through the normal queue turns them
into real severity labels far faster than waiting for patients to walk in.

They land in `$DATASETS_DIR/_incoming/`, which `ai.training.dimension.ingest`
deliberately does NOT read. Nothing here can reach the trainer by accident.

WHY THESE TWO AND NOT THE POPULAR ONES
--------------------------------------
Rejected, with reasons:

  rishantrokaha/skin-wrinkles-vs-nonwrinkles
      9-23 KB images. Too compressed to show a fine line at all, and the
      wrinkled examples are press/stock photos of older people while the smooth
      ones are young selfies — the model would learn photo style and age.

  shijo96john/facial-skin-acne-pigmentation-pores-wrinkles
  killa92/facial-skin-analysis-and-type-classification
  ranvijaybalbir/acne-wrinkles-spots-classification
      Roboflow re-exports (.rf. hashes) from the same corpus family already
      sitting in <dim>/multi/. That corpus supplied 497 images reused as the
      "none" class for four different dimensions at once and is exactly what
      made four dimension models score 0.96-1.00 and get deleted on 2026-07-27.

  drishyatomar/glowmix-merged-facial-skincare-dataset
      4 GB and "merged" from multiple sources — merging is the leak.

Accepted: both TrainingDataPro sets. One publisher, one rig, high resolution,
and front/left/right angles that match what the app captures.
"""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

from ai.training.paths import datasets_dir


def _kaggle_cmd() -> str:
    """The venv's kaggle, not a global one — `make` does not inherit the venv."""
    local = Path(sys.executable).parent / "kaggle"
    return str(local) if local.exists() else "kaggle"

# ref -> (subfolder, why it earns its disk space)
DATASETS: dict[str, tuple[str, str]] = {
    "trainingdatapro/skin-defects-acne-redness-and-bags-under-the-eyes": (
        "skin-defects",
        "10 subjects x 3 angles for each of acne / redness / under-eye bags "
        "(90 images), 3456x4608, one capture rig. Feeds redness and under-eye.",
    ),
    "trainingdatapro/botox-injections-before-and-after": (
        "botox",
        "23 before/after pairs (46 images) from the same rig — the before "
        "frames are wrinkle/fine-line positives with matched negatives.",
    ),
}


def fetch(ref: str, sub: str) -> bool:
    dest = datasets_dir() / "_incoming" / sub
    if dest.exists() and (any(dest.rglob("*.jpg")) or any(dest.rglob("*.png"))):
        print(f"  already present: {sub}")
        return True
    dest.mkdir(parents=True, exist_ok=True)
    print(f"  downloading {ref} -> {dest}")
    r = subprocess.run(
        [_kaggle_cmd(), "datasets", "download", "-d", ref, "-p", str(dest), "--unzip"],
        capture_output=True,
        text=True,
    )
    if r.returncode != 0:
        # Most often: no ~/.kaggle/kaggle.json, or the dataset needs its terms
        # accepted on the website first.
        print(f"  FAILED {ref}: {r.stderr.strip()[:200]}", file=sys.stderr)
        return False
    return True


def main() -> None:
    print(f"Fetching into {datasets_dir() / '_incoming'} (not read by the trainer)\n")
    ok = 0
    for ref, (sub, why) in DATASETS.items():
        print(f"{ref}\n  {why}")
        if fetch(ref, sub):
            ok += 1
        print()
    print(f"{ok}/{len(DATASETS)} available.")
    print(
        "\nThese are presence/absence, NOT severity-graded. Next step:\n"
        "  make import-for-grading   # load them into the queue to be graded\n"
        "Then grade in the app, hit Export graded scans, and check:\n"
        "  make dimension-readiness"
    )


if __name__ == "__main__":
    main()
