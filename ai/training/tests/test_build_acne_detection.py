import json
from pathlib import Path

from PIL import Image

from ai.training.localize import build_acne_detection as bad


def test_source_stem_strips_roboflow_suffix():
    assert bad.source_stem("levle0_163_jpg.rf.0a1b2c") == "levle0_163"
    assert bad.source_stem("plain_name") == "plain_name"


def test_merge_label_lines_merges_classes_and_polygons():
    lines = bad.merge_label_lines("2 0.5 0.5 0.1 0.2\n0 0.1 0.1 0.3 0.1 0.3 0.3 0.1 0.3\nbad")
    assert lines == ["0 0.500000 0.500000 0.100000 0.200000",
                     "0 0.200000 0.200000 0.200000 0.200000"]


def test_split_is_per_group_and_stable():
    assert bad.split_of("levle0_1") == bad.split_of("levle0_1")
    assert {bad.split_of(f"g{i}") for i in range(200)} == {"train", "val", "test"}


def test_frozen_exclusions_cover_stems_and_groups(tmp_path):
    f = tmp_path / "frozen.json"
    f.write_text(json.dumps({"paths": ["acne/acne04/mild/levle0_9"], "groups": ["e589522b7afbd6719019"]}))
    assert bad.frozen_exclusions(f) == {"levle0_9", "e589522b7afbd6719019"}


def _write(root: Path, split: str, stem: str, label: str) -> None:
    (root / split / "images").mkdir(parents=True, exist_ok=True)
    (root / split / "labels").mkdir(parents=True, exist_ok=True)
    Image.new("RGB", (32, 32), (180, 140, 120)).save(root / split / "images" / f"{stem}.jpg")
    (root / split / "labels" / f"{stem}.txt").write_text(label)


def test_collect_groups_roboflow_copies_and_excludes_frozen(tmp_path):
    _write(tmp_path, "train", "levle0_1_jpg.rf.aa", "0 0.5 0.5 0.1 0.1")
    _write(tmp_path, "valid", "levle0_1_jpg.rf.bb", "0 0.5 0.5 0.1 0.1")
    _write(tmp_path, "train", "levle0_2_jpg.rf.cc", "0 0.5 0.5 0.1 0.1")
    rows = bad.collect(tmp_path, excluded={"levle0_2"})
    assert sorted(group for _, _, group in rows) == ["levle0_1", "levle0_1"]


def test_main_writes_one_class_tree_and_a_split_manifest(tmp_path, monkeypatch):
    raw, out = tmp_path / "raw", tmp_path / "out"
    for i in range(30):
        _write(raw, "train", f"p{i}_jpg.rf.aa", "3 0.5 0.5 0.2 0.2")
    monkeypatch.setattr(bad, "FROZEN", tmp_path / "missing.json")
    assert bad.main([str(raw), str(out)]) == 0
    labels = list((out / "labels").rglob("*.txt"))
    assert len(labels) == 30 and all(p.read_text().startswith("0 ") for p in labels)
    assert "names:\n  0: acne" in (out / "data.yaml").read_text()
    manifest = json.loads((out / "split_manifest.json").read_text())
    assert len(manifest["sha256"]) == 64
    assert manifest["images"] == sorted(p.name for p in (out / "images" / "test").glob("*.jpg"))


def test_main_refuses_a_nonempty_out(tmp_path, capsys):
    raw, out = tmp_path / "raw", tmp_path / "out"
    out.mkdir()
    (out / "stale.txt").write_text("leftover from a previous run")
    assert bad.main([str(raw), str(out)]) == 1
    assert "non-empty" in capsys.readouterr().err
    assert [p.name for p in out.iterdir()] == ["stale.txt"]  # left untouched
