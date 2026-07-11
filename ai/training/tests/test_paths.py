import os
from pathlib import Path
from ai.training.paths import datasets_dir, raw_dir, master_dir, duplicates_dir

def test_default_is_ai_datasets(monkeypatch):
    monkeypatch.delenv("DATASETS_DIR", raising=False)
    assert datasets_dir() == Path("ai/datasets")

def test_env_override_relocates(monkeypatch, tmp_path):
    monkeypatch.setenv("DATASETS_DIR", str(tmp_path))
    assert datasets_dir() == tmp_path
    assert raw_dir("isic2019") == tmp_path / "raw" / "isic2019"
    assert master_dir() == tmp_path / "master"
    assert duplicates_dir() == tmp_path / "duplicates"
