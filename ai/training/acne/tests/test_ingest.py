from pathlib import Path

import numpy as np
from PIL import Image

from ai.training.acne.labels import ACNE_CLASSES, normalize_acne_label
from ai.training.acne import ingest


def test_normalize_label_aliases():
    assert normalize_acne_label("2") == "moderate"
    assert normalize_acne_label("MILD") == "mild"
    assert normalize_acne_label("nodulocystic") == "very-severe"
    assert normalize_acne_label("nonsense") is None


def test_five_ordinal_classes():
    assert ACNE_CLASSES == ["clear", "mild", "moderate", "severe", "very-severe"]


def _img(path: Path):
    path.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(np.full((16, 16, 3), 128, np.uint8)).save(path)


def test_collect_all_reads_folders_and_scans(monkeypatch, tmp_path):
    monkeypatch.setenv("DATASETS_DIR", str(tmp_path))
    _img(tmp_path / "acne" / "ext-dataset" / "mild" / "a.jpg")
    _img(tmp_path / "acne" / "ext-dataset" / "severe" / "b.jpg")
    _img(tmp_path / "acne" / "scans" / "2" / "scan-x.jpg")  # exported app scan, alias "2"
    _img(tmp_path / "acne" / "ext-dataset" / "not-a-label" / "c.jpg")  # ignored

    rows = ingest.collect_all()
    labels = sorted(r["label"] for r in rows)
    assert labels == ["mild", "moderate", "severe"]  # scan "2" → moderate; junk folder dropped
    assert ingest.label_counts(rows)["moderate"] == 1


def test_collect_all_reads_csv(monkeypatch, tmp_path):
    monkeypatch.setenv("DATASETS_DIR", str(tmp_path))
    (tmp_path / "acne").mkdir(parents=True)
    img = tmp_path / "acne" / "x.jpg"
    _img(img)
    (tmp_path / "acne" / "labels.csv").write_text(f"path,label\n{img},severe\n")
    rows = ingest.collect_all()
    assert any(r["label"] == "severe" and r["path"] == str(img) for r in rows)
