"""Validate annotator JSONL and materialise it into trainer-readable folders.

    $DATASETS_DIR/<attribute>/<source>/<label>/<image>

Strict on purpose: the backend silently drops invalid label strings, so this
rejects them LOUDLY instead (per-line errors in the report). No alias
normalisation — an annotator writing "mild" for a binary dimension is a rubric
violation to surface, not to paper over.

Labels land in source "auto" by default, which the trainer ignores until
DIMENSION_EXTRA_SOURCES includes it — clinic "scans" stay the held-out truth.
"""
from __future__ import annotations

import json
import os
import shutil
import sys
from pathlib import Path

from ai.training.acne.labels import ACNE_CLASSES
from ai.training.dimension.ingest import SEVERITY_DIMENSIONS
from ai.training.dimension.labels import PRESENCE_CLASSES
from ai.training.paths import datasets_dir
from ai.training.skintype.labels import SKIN_TYPE_CLASSES

VOCAB: dict[str, list[str]] = {
    "acne": ACNE_CLASSES,
    "skintype": SKIN_TYPE_CLASSES,
    **{d: PRESENCE_CLASSES for d in SEVERITY_DIMENSIONS},
}
QUALITY = {"ok", "blurry", "dark", "occluded", "not-a-face"}

# acne and skintype already have trained heads (macro F1 0.741 / 0.691) built on
# real graded data, and their ingest.collect_all() reads EVERY source folder with
# no opt-in gate — unlike dimensions, which honour DIMENSION_EXTRA_SOURCES. So
# writing AI labels into acne/auto/ would silently join the two models that work.
# Their labels stay in the JSONL; pass include_trained=True to actually use them.
GATED = {"acne", "skintype"}


def validate_record(rec: dict) -> list[str]:
    """Errors for one record; empty list = valid."""
    errs = []
    if not isinstance(rec.get("image"), str) or not rec["image"]:
        errs.append("missing image path")
    if rec.get("quality") not in QUALITY:
        errs.append(f"quality {rec.get('quality')!r} not in {sorted(QUALITY)}")
    labels = rec.get("labels")
    if not isinstance(labels, dict):
        errs.append("labels must be an object")
        return errs
    for attr, value in labels.items():
        allowed = VOCAB.get(attr)
        if allowed is None:
            errs.append(f"unknown attribute {attr!r}")
        elif value not in allowed:
            errs.append(f"{attr}={value!r} not in {allowed}")
    return errs


def _manifest_index() -> dict[str, dict]:
    p = datasets_dir() / "_labels" / "manifest.jsonl"
    if not p.exists():
        return {}
    return {r["image"]: r for r in (json.loads(l) for l in p.read_text().splitlines() if l.strip())}


def link_name(rec_image: str, meta: dict | None) -> str:
    """`<source>__<subject>[__<stem>]<ext>` — unique, and groupable by subject.

    Basenames are NOT unique across this corpus: 1136 of them repeat, `front.jpg`
    28 times over. Naming links by basename made 2592 images collide, and since an
    existing destination reads as already-done they were dropped in silence.

    Keeping <source>__<subject> as the first two fields lets the trainer's group
    key span a subject's several angles, so one face cannot sit on both sides of
    the train/val split.
    """
    p = Path(rec_image)
    if not meta:
        return f"{'__'.join(p.with_suffix('').parts)}{p.suffix}"
    subject = str(meta["subject"]).replace("__", "_")
    tail = "" if subject == p.stem else f"__{p.stem}"
    return f"{meta['source']}__{subject}{tail}{p.suffix}"


def materialize(jsonl_path: str | Path, source: str = "auto", include_trained: bool = False) -> dict:
    """Link every confident, quality-ok label into <attr>/<source>/<label>/."""
    base = datasets_dir()
    index = _manifest_index()
    report = {
        "linked": 0,
        "skipped_uncertain": 0,
        "skipped_gated": 0,
        "dropped_quality": 0,
        "invalid": [],
    }
    for n, line in enumerate(Path(jsonl_path).read_text().splitlines(), 1):
        if not line.strip():
            continue
        rec = json.loads(line)
        errs = validate_record(rec)
        if errs:
            report["invalid"].append(f"line {n}: {'; '.join(errs)}")
            continue
        if rec["quality"] != "ok":
            report["dropped_quality"] += 1
            continue
        img = base / rec["image"]
        name = link_name(rec["image"], index.get(rec["image"]))
        uncertain = set(rec.get("uncertain", []))
        for attr, value in rec["labels"].items():
            if attr in uncertain:
                report["skipped_uncertain"] += 1
                continue
            if attr in GATED and not include_trained:
                report["skipped_gated"] += 1
                continue
            dest = base / attr / source / value / name
            if dest.exists():
                continue
            dest.parent.mkdir(parents=True, exist_ok=True)
            try:
                os.link(img, dest)  # no extra disk when same volume
            except OSError:
                shutil.copy2(img, dest)
            report["linked"] += 1
    return report


if __name__ == "__main__":
    r = materialize(sys.argv[1], *(sys.argv[2:3] or []))
    for e in r["invalid"]:
        print(f"INVALID {e}", file=sys.stderr)
    print({k: v for k, v in r.items() if k != "invalid"})
    sys.exit(1 if r["invalid"] else 0)
