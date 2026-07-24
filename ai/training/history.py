"""Append-only per-model training history — the 'before/after' record.

Each evaluated run appends one line to ai/models/<model>/history.jsonl. The
in-app training dashboard reads it (GET /api/training/<dim>/history) to chart how
the model improved across retrains.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path


def append_run(model_parent: Path, version: str, metrics: dict, counts: dict | None = None) -> None:
    model_parent.mkdir(parents=True, exist_ok=True)
    rec = {
        "version": version,
        "at": datetime.now(timezone.utc).isoformat(),
        "metrics": metrics,
        "counts": counts or {},
    }
    with open(model_parent / "history.jsonl", "a") as f:
        f.write(json.dumps(rec) + "\n")
