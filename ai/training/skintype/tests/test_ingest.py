"""Skin-type label + ingest tests (no torch, no network)."""
from __future__ import annotations

from pathlib import Path

import pytest

from ai.training.skintype.labels import SKIN_TYPE_CLASSES, normalize_skin_type
from ai.training.skintype import ingest


def test_classes_are_the_four_types():
    assert SKIN_TYPE_CLASSES == ["normal", "oily", "dry", "combination"]


@pytest.mark.parametrize(
    "raw,expected",
    [("Oily", "oily"), ("DRY", "dry"), ("combo", "combination"),
     ("normal", "normal"), (" comb ", "combination"), ("acne", None)],
)
def test_normalize(raw, expected):
    assert normalize_skin_type(raw) == expected


def test_collect_folders_and_scans(tmp_path, monkeypatch):
    root = tmp_path / "skintype"
    for src, cls in [("killa92", "oily"), ("killa92", "dry"), ("scans", "normal")]:
        d = root / src / cls
        d.mkdir(parents=True, exist_ok=True)
        (d / f"{src}_{cls}.jpg").write_bytes(b"x")
    monkeypatch.setattr(ingest, "skintype_dir", lambda: root)
    rows = ingest.collect_all()
    counts = ingest.label_counts(rows)
    assert counts["oily"] == 1 and counts["dry"] == 1 and counts["normal"] == 1
    assert {r["label"] for r in rows} == {"oily", "dry", "normal"}
