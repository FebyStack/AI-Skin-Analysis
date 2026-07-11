import numpy as np
from PIL import Image
from ai.training.build_master import split_rows

def _rows(n_per_class=20):
    rows = []
    for cls in ["Melanoma", "Nevus"]:
        for i in range(n_per_class):
            rows.append({"path": f"/x/{cls}_{i}.png", "label": cls,
                         "group": f"{cls}_patient_{i // 4}"})  # 4 images per patient
    return rows

def test_split_is_grouped_and_stratified():
    train, val, test = split_rows(_rows(), seed=0)
    # no patient group crosses splits (leakage guard)
    def groups(s): return {r["group"] for r in s}
    assert groups(train).isdisjoint(groups(val))
    assert groups(train).isdisjoint(groups(test))
    assert groups(val).isdisjoint(groups(test))
    # both classes present in every split
    for s in (train, val, test):
        assert {r["label"] for r in s} == {"Melanoma", "Nevus"}

def test_split_deterministic():
    a = split_rows(_rows(), seed=0)
    b = split_rows(_rows(), seed=0)
    assert [r["path"] for r in a[0]] == [r["path"] for r in b[0]]
