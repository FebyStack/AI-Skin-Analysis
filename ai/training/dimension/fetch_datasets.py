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

Second sweep (2026-08-01), aimed at the `present`-class gaps in the 10 binary
dimensions. Nine permissively-licensed Kaggle sets were downloaded and checked;
all nine failed, each for a reason worth writing down so nobody re-fetches them:

  indahlestari23/skin-problems-multi-label-dataset            MIT, 178 MB
      The one with the right SHAPE: 4,547 images, one pool, per-image binary
      labels for Acne/Blackheads/Dark Spots/Dry Skin/Eye bags/Normal/Oily/
      Pores/Redness/Wrinkles — positives and negatives from the same images by
      construction. It still fails: it is a MERGE, and the filename family
      predicts the label almost perfectly. Pores 232/267 and Wrinkles 371/403
      are the numeric-named family; Acne 1171 is the "acne-N-" family and 890
      the "levleN_N" family; Dry Skin 381/430 and Oily 216/247 are Indonesian
      "kering-"/"oily-" scrapes; all 249 Normal and all 37 Redness sit in yet
      another family. The corpus cue survives the multi-label format.

  shakyadissanayake/oily-dry-and-normal-skin-types-dataset    "apache-2.0", 136 MB
  manithj/oily-and-dry-skin-dataset                           "apache-2.0", 121 MB
      Byte-identical class counts (652 dry / 1104 normal / 1000 oily) — one
      dataset uploaded twice. A contact sheet shows what it actually is: a web
      image scrape. Visible Shutterstock watermarks, Danish skincare marketing
      copy burnt into frames, product shots, magnifying-glass stock photos,
      rotation augmentation, and faces that do not show the labelled condition.
      The Apache-2.0 tag was not the uploader's to give.

  rajeshpandhare/skin-classification-normal-acne-oily-dry-wrinkle   "MIT", 61 MB
      The negative class is literally istockphoto-*.jpg and gettyimages-*.jpg
      while every positive class is a 640x640 Roboflow export. Textbook leak,
      and again a licence the uploader could not grant.

  muttaqin1113/faceskintype                                   "apache-2.0", 339 MB
      Four classes, each scraped separately — filenames are "berjerawat (1)",
      "berminyak (1)", "kering (1)", "normal (1)", the browser duplicate-download
      pattern. Per-class scrape means per-class photographic style.

  bishalsharma000/facial-skin-datasets                        "apache-2.0", 13 MB
      Ships a subfolder named "02_01+shutterphoto". 429 images total.

  hafsamahbub17/acne-and-wrinkles-dataset                     CC0-1.0, 205 MB
      Two folders from two corpora: "acne-cystic-N.jpg" (DermNet clinical
      naming) versus "images (N).jpg" (Google scrape). No shared negative.

  abhayyadav1074/skin-disease-classification-for-skin-analysis-tool  "MIT", 648 MB
      DermNet disease folders re-merged with the Oily-Dry scrape above (its
      dry count is the same 652). Its own `bags` and `redness` folders hold
      27 images each — too few, and from a different origin than the rest.

  osmankagankurnaz/facial-skin-diseases-dataset               "apache-2.0", 8 MB
      TFRecords, acne only.

LICENCE WARNING on the two accepted sets below: both are CC BY-NC-ND 4.0.
NonCommercial rules out a paid clinic product, and NoDerivatives is at best
untested for model weights. Fine for research; get written permission from the
publisher (roman@kucev.com) before anything trained on them ships.

Accepted: both TrainingDataPro sets. One publisher, one rig, high resolution,
and front/left/right angles that match what the app captures. Between them they
can only serve redness, under-eye, wrinkles and fine-lines. For pigmentation,
texture, pores, dryness, oiliness and tone-consistency no public corpus was
found that carries both classes — the clinician grading loop is the only source.
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
