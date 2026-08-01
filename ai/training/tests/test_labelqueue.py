import json

from ai.training.dimension import labelqueue as q


def test_interleave_round_robins_longest_source_first():
    rows = q.interleave({"small": [{"n": 1}, {"n": 2}], "big": [{"n": 10}, {"n": 20}, {"n": 30}]})
    assert [r["n"] for r in rows] == [10, 1, 20, 2, 30]


def test_batches_are_assigned_in_manifest_order(monkeypatch):
    monkeypatch.setattr(q, "BATCH_SIZE", 2)
    rows = q.assign_batches([{"image": str(i)} for i in range(5)])
    assert [r["batch"] for r in rows] == [0, 0, 1, 1, 2]


def test_subject_spans_angles_for_multi_angle_sources():
    from pathlib import Path

    assert q.subject_of("skindefects", Path("files/redness/27/front.jpg")) == "redness-27"
    assert q.subject_of("killa92", Path("dataset/oily/x9.jpg")) == "x9"


def test_next_batch_skips_already_labelled(tmp_path, monkeypatch):
    monkeypatch.setenv("DATASETS_DIR", str(tmp_path))
    labels = tmp_path / "_labels"
    labels.mkdir()
    (labels / "manifest.jsonl").write_text(
        "\n".join(json.dumps({"image": f"s/{i}.jpg", "batch": i // 2}) for i in range(6))
    )
    (labels / "batch-000.jsonl").write_text(
        json.dumps({"image": "s/0.jpg", "labels": {}, "quality": "dark"})
    )

    n, rows = q.next_batch()

    assert n == 0
    assert [r["image"] for r in rows] == ["s/1.jpg"]  # 0 done, rest of batch 0 remains


def test_next_batch_returns_none_when_corpus_exhausted(tmp_path, monkeypatch):
    monkeypatch.setenv("DATASETS_DIR", str(tmp_path))
    labels = tmp_path / "_labels"
    labels.mkdir()
    (labels / "manifest.jsonl").write_text(json.dumps({"image": "s/0.jpg", "batch": 0}))
    (labels / "batch-000.jsonl").write_text(
        json.dumps({"image": "s/0.jpg", "labels": {}, "quality": "ok"})
    )
    assert q.next_batch() == (None, [])


def test_group_key_spans_a_subjects_angles():
    from ai.training.dimension.ingest import group_key

    assert group_key("skindefects__acne-1__front") == "skindefects__acne-1"
    assert group_key("skindefects__acne-1__left_side") == "skindefects__acne-1"
    assert group_key("killa92__x9") == "killa92__x9"
    assert group_key("0bfc17ea-0b16-41ea-8bbd-2dc09dde8ae8") == "0bfc17ea-0b16-41ea-8bbd-2dc09dde8ae8"
