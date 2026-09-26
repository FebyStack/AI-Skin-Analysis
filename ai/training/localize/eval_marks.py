"""Score the shipped acne pinpoints against staff taps — the locked clinic localization exam.

    .venv.nosync/bin/python -m ai.training.localize.eval_marks [DIR]

DIR (default $DATASETS_DIR/localization/clinic) holds marks.jsonl written by
POST /api/localization-exam/export: per photo, staff `points` and the model's saved `predictions`.
A prediction matches a point when the point lies inside its box; one-to-one, highest confidence first.
Clinic photos are never detector training data in Phase 1, so this set stays a clean exam.
"""
from __future__ import annotations

import json
import sys
from collections import defaultdict
from pathlib import Path

from ai.training.paths import datasets_dir

MIN_PHOTOS, MIN_RECALL, MIN_PRECISION = 50, 0.70, 0.70


def match(points: list[dict], predictions: list[dict]) -> int:
    free, hits = list(points), 0
    for p in sorted(predictions, key=lambda q: -q.get("confidence", 0.0)):
        for i, pt in enumerate(free):
            if p["x"] <= pt["x"] <= p["x"] + p["w"] and p["y"] <= pt["y"] <= p["y"] + p["h"]:
                free.pop(i)
                hits += 1
                break
    return hits


def score(rows: list[dict]) -> dict:
    points = sum(len(r["points"]) for r in rows)
    predictions = sum(len(r["predictions"]) for r in rows)
    hits = sum(match(r["points"], r["predictions"]) for r in rows)
    return {
        "photos": len(rows),
        "recall": hits / points if points else 0.0,
        "precision": hits / predictions if predictions else 0.0,
        "count_mae": sum(abs(len(r["points"]) - len(r["predictions"])) for r in rows) / len(rows) if rows else 0.0,
    }


def main(argv: list[str]) -> int:
    folder = Path(argv[0]) if argv else datasets_dir() / "localization" / "clinic"
    rows = [json.loads(line) for line in (folder / "marks.jsonl").read_text().splitlines() if line.strip()]
    s = score(rows)
    print(f"overall  photos={s['photos']}  recall={s['recall']:.2f}  precision={s['precision']:.2f}  "
          f"count error={s['count_mae']:.2f}")
    by_device: dict[str, list[dict]] = defaultdict(list)
    for r in rows:
        by_device[r.get("device", "unknown")].append(r)
    for device, rs in sorted(by_device.items()):
        d = score(rs)
        print(f"  {device:24} photos={d['photos']}  recall={d['recall']:.2f}  precision={d['precision']:.2f}")
    passed = s["photos"] >= MIN_PHOTOS and s["recall"] >= MIN_RECALL and s["precision"] >= MIN_PRECISION
    print("PASS — may be shown to patients" if passed
          else f"NOT YET — needs >= {MIN_PHOTOS} photos with recall and precision >= {MIN_RECALL:.2f}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
