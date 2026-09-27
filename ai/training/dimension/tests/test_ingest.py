"""Generic per-dimension label + ingest tests (no torch, no network)."""
from __future__ import annotations

import pytest
from PIL import Image

from ai.training.dimension import ingest
from ai.training.dimension.labels import PRESENCE_CLASSES, normalize_presence


def test_presence_vocabulary():
    assert PRESENCE_CLASSES == ["absent", "present"]


@pytest.mark.parametrize(
    "raw,expected",
    [("present", "present"), ("Absent", "absent"), ("clear", "absent"),
     ("severe", "present"), ("banana", None)],
)
def test_normalize(raw, expected):
    assert normalize_presence(raw) == expected


def _make_tree(root):
    for source, cls in [("multi", "present"), ("multi", "absent"), ("scans", "present")]:
        d = root / "redness" / source / cls
        d.mkdir(parents=True, exist_ok=True)
        # Real JPEGs: clinic scans are phash-regrouped, which opens each file.
        Image.new("RGB", (8, 8)).save(d / f"{source}_{cls}.jpg")


def test_collect_defaults_to_clinic_scans_only(tmp_path, monkeypatch):
    _make_tree(tmp_path)
    monkeypatch.setattr(ingest, "datasets_dir", lambda: tmp_path)
    monkeypatch.delenv("DIMENSION_EXTRA_SOURCES", raising=False)
    assert ingest.counts_for("redness") == {"present": 1}


def test_extra_sources_opt_in(tmp_path, monkeypatch):
    _make_tree(tmp_path)
    monkeypatch.setattr(ingest, "datasets_dir", lambda: tmp_path)
    monkeypatch.setenv("DIMENSION_EXTRA_SOURCES", "multi")
    assert ingest.counts_for("redness") == {"absent": 1, "present": 2}
