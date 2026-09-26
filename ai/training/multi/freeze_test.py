"""Freeze the current held-out test split so every future model sits the same exam.

Adding a dataset reshuffles split_rows(), which silently moves old test images into
training and makes scores incomparable across runs. The frozen file records the test
images (path relative to DATASETS_DIR, no extension — normalisation changes suffixes)
and their groups; train_multi --frozen-test keeps both out of train/val.

    DATASETS_DIR=... .venv/bin/python -m ai.training.multi.freeze_test
"""
from __future__ import annotations

import json
from pathlib import Path

from ai.training.build_master import split_rows
from ai.training.multi.tasks import collect_rows
from ai.training.paths import datasets_dir

OUT = Path("ai/training/multi/frozen_test.json")


def rel_key(path: str) -> str:
    return str(Path(path).relative_to(datasets_dir()).with_suffix(""))


def main() -> int:
    _, _, test = split_rows(collect_rows(), seed=0)
    OUT.write_text(json.dumps({
        "note": "held-out exam frozen 2026-09-21 from the seed-0 split of the 5,942-image corpus",
        "paths": sorted(rel_key(r["path"]) for r in test),
        "groups": sorted({r["group"] for r in test}),
    }, indent=1))
    print(f"froze {len(test)} test images ({len({r['group'] for r in test})} groups) -> {OUT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
