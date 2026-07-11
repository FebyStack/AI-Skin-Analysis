# ai/training/tests/test_train_smoke.py
import json
import numpy as np
from PIL import Image
from ai.training.train import train_one

def _make(tmp_path, n=6):
    rows = []
    for cls in ["Melanoma", "Nevus"]:
        for i in range(n):
            p = tmp_path / f"{cls}_{i}.png"
            lum = 30 if cls == "Melanoma" else 220
            Image.fromarray(np.full((32, 32, 3), lum, np.uint8)).save(p)
            rows.append({"path": str(p), "label": cls, "group": f"{cls}_{i}"})
    return rows

def test_train_one_epoch_writes_candidate(tmp_path):
    rows = _make(tmp_path)
    out = tmp_path / "candidate"
    info = train_one(train_rows=rows, val_rows=rows, classes=["Melanoma", "Nevus"],
                     epochs=1, out_dir=out, seed=0)
    assert (out / "current.pt").exists()
    meta = json.loads((out / "model.json").read_text())
    assert meta["classes"] == ["Melanoma", "Nevus"]
    assert 0.0 <= info["val_macro_f1"] <= 1.0
