"""All dataset paths derive from DATASETS_DIR — set it to an external disk to relocate everything."""
import os
from pathlib import Path

def datasets_dir() -> Path:
    return Path(os.environ.get("DATASETS_DIR", "ai/datasets"))

def raw_dir(source: str) -> Path:
    return datasets_dir() / "raw" / source

def master_dir() -> Path:
    return datasets_dir() / "master"

def duplicates_dir() -> Path:
    return datasets_dir() / "duplicates"
