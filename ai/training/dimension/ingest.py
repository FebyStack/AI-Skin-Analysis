"""Training rows for any severity-graded dimension.

Layout mirrors acne/skintype so the backend's existing export lands in the right
place with no new plumbing:

    $DATASETS_DIR/<dimension>/<source>/<severity>/*.jpg

The backend writes `<source>` = "scans" from POST /api/training/<dim>/export,
so clinician-graded scans and any external corpus merge automatically.

Deliberately NOT wired to any public dataset. Four dimension models were deleted
on 2026-07-27 because positives and negatives came from different corpora and the
model learned photographic style instead of skin. Anything dropped in here must
share the clinic's camera and lighting distribution, or be held out for eval only.
"""
from __future__ import annotations

import os
from pathlib import Path

from ai.training.dedup import phash_group_map, subject_group
from ai.training.dimension.labels import normalize_presence
from ai.training.paths import datasets_dir

IMG_EXTS = {".jpg", ".jpeg", ".png", ".webp"}

# Clinic-graded exports only, by default.
#
# This is not caution for its own sake. The other source folders on disk today
# ("multi") hold 497 images reused as the "none" class for redness, pigmentation,
# pores AND wrinkles at once — Roboflow acne photos that were never graded for
# any of those dimensions. Training on them teaches the model which CORPUS a
# photo came from, which is how four dimension models scored 0.96-1.00 and were
# deleted as worthless on 2026-07-27.
#
# Set DIMENSION_EXTRA_SOURCES="multi,other" to opt in deliberately. Only do that
# when positives and negatives share one camera/lighting distribution, and hold
# out clinic scans for evaluation.
CLINIC_SOURCE = "scans"


def allowed_sources() -> set[str]:
    extra = os.environ.get("DIMENSION_EXTRA_SOURCES", "")
    return {CLINIC_SOURCE} | {s.strip() for s in extra.split(",") if s.strip()}

# Dimensions graded on the 4-level severity scale (i.e. everything except acne,
# which has its own 5 levels, and skintype, which is categorical).
SEVERITY_DIMENSIONS: list[str] = [
    "redness",
    "pigmentation",
    "oiliness",
    "texture",
    "pores",
    "fine-lines",
    "wrinkles",
    "dryness",
    "under-eye",
    "tone-consistency",
]


def collect_for(dimension: str) -> list[dict]:
    """Every labelled image for one dimension, across all source folders."""
    base = datasets_dir() / dimension
    rows: list[dict] = []
    if not base.exists():
        return rows
    permitted = allowed_sources()
    for source_dir in sorted(p for p in base.iterdir() if p.is_dir()):
        if source_dir.name not in permitted:
            continue
        source_rows: list[dict] = []
        for label_dir in sorted(p for p in source_dir.iterdir() if p.is_dir()):
            label = normalize_presence(label_dir.name)
            if label is None:
                continue
            for img in label_dir.iterdir():
                if img.suffix.lower() in IMG_EXTS:
                    # The external corpora encode the subject in the filename,
                    # so the stem is enough to keep one person's angles together.
                    source_rows.append(
                        {"path": str(img), "label": label, "group": group_key(img.stem)}
                    )
        # Clinic scans are named with a bare UUID, so the line above gives every
        # capture its own group and two frames of one person taken seconds apart
        # end up on opposite sides of the split. Regroup those by image content.
        if source_dir.name == "scans" and source_rows:
            clusters = phash_group_map(r["path"] for r in source_rows)
            for r in source_rows:
                r["group"] = clusters[r["path"]]
        rows.extend(source_rows)
    return rows


# Subject key for the train/val split — shared with acne and skintype ingest so
# all three group one photograph's copies and one person's angles identically.
group_key = subject_group


def counts_for(dimension: str) -> dict[str, int]:
    out: dict[str, int] = {}
    for r in collect_for(dimension):
        out[r["label"]] = out.get(r["label"], 0) + 1
    return out
