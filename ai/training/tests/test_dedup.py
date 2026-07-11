# ai/training/tests/test_dedup.py
import numpy as np
from PIL import Image
from ai.training.dedup import phash_hex, find_duplicates

def _save(path, lum):
    Image.fromarray(np.full((64, 64, 3), lum, np.uint8)).save(path)

def test_phash_stable(tmp_path):
    p = tmp_path / "a.png"; _save(p, 100)
    assert phash_hex(p) == phash_hex(p)

def test_finds_near_and_id_duplicates(tmp_path):
    rows = []
    for name, lum, sid in [("a.png", 100, "S1"), ("b.png", 101, "S2"), ("c.png", 10, "S1")]:
        _save(tmp_path / name, lum)
        rows.append({"path": str(tmp_path / name), "source_id": sid})
    keep, dropped = find_duplicates(rows, hamming_max=4)
    dropped_paths = {d["path"] for d in dropped}
    # b is a near-dup of a (pHash); c shares source_id S1 with a
    assert len(keep) == 1
    assert len(dropped_paths) == 2
