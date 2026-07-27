"""Generic per-dimension label + ingest tests (no torch, no network)."""
from __future__ import annotations

import pytest

from ai.training.dimension import ingest
from ai.training.dimension.labels import DIMENSION_CLASSES, classes_for, normalize_label


def test_registry_covers_requested_dimensions():
    for d in ("redness", "wrinkles", "pores", "pigmentation"):
        assert classes_for(d) == ["absent", "present"]


def test_unknown_dimension_raises():
    with pytest.raises(KeyError):
        classes_for("not-a-dimension")


@pytest.mark.parametrize(
    "raw,expected",
    [("present", "present"), ("Absent", "absent"), ("clear", "absent"),
     ("moderate", "present"), ("banana", None)],
)
def test_normalize(raw, expected):
    assert normalize_label("redness", raw) == expected


def test_collect_folders_and_scans(tmp_path, monkeypatch):
    root = tmp_path / "redness"
    for source, cls in [("multi", "present"), ("multi", "absent"), ("scans", "present")]:
        d = root / source / cls
        d.mkdir(parents=True, exist_ok=True)
        (d / f"{source}_{cls}.jpg").write_bytes(b"x")
    monkeypatch.setattr(ingest, "dimension_dir", lambda _dim: root)
    rows = ingest.collect_all("redness")
    counts = ingest.label_counts("redness", rows)
    assert counts == {"absent": 1, "present": 2}
