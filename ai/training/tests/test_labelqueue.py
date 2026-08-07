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


def test_within_source_order_is_shuffled_not_path_sorted():
    """Sources store one class per directory, so path order emits them in
    blocks: every killa92 'oily' face sat past batch 62, beyond where the
    40/class bar is reached. Any prefix must see every class of every source."""
    rows = [{"image": f"killa92/{c}/{i}.jpg"}
            for c in ("combination", "dry", "normal", "oily") for i in range(25)]
    out = q.shuffle_within_source({"killa92": list(rows)})["killa92"]
    assert {r["image"].split("/")[1] for r in out[:25]} == {"combination", "dry", "normal", "oily"}


def test_shuffle_is_deterministic_so_the_manifest_is_reproducible():
    rows = [{"image": f"s/{i}.jpg"} for i in range(50)]
    assert (q.shuffle_within_source({"s": list(rows)})["s"]
            == q.shuffle_within_source({"s": list(rows)})["s"])


def test_a_subjects_angles_stay_in_one_batch():
    """skin-defects ships front/left_side/right_side per subject, and the
    shadow-vs-pigment test needs to compare them. Shuffling by IMAGE scattered
    53 of 54 multi-image subjects across different batches, so no annotator ever
    saw two angles of the same face."""
    rows = [{"image": f"s/{s}/{a}.jpg", "source": "skindefects", "subject": s}
            for s in ("a", "b", "c") for a in ("front", "left", "right")]
    out = q.assign_batches(q.keep_subjects_together(list(reversed(rows))))
    for s in ("a", "b", "c"):
        assert len({r["batch"] for r in out if r["subject"] == s}) == 1


def test_a_batch_boundary_never_splits_a_subject(monkeypatch):
    monkeypatch.setattr(q, "BATCH_SIZE", 4)
    rows = [{"image": f"s/{s}/{a}.jpg", "source": "sd", "subject": s}
            for s in ("a", "b", "c") for a in ("1", "2", "3")]
    out = q.assign_batches(q.keep_subjects_together(rows))
    for s in ("a", "b", "c"):
        assert len({r["batch"] for r in out if r["subject"] == s}) == 1


def test_work_units_pack_the_remainder_into_full_batches(monkeypatch):
    """After a manifest rebuild the done images scatter, leaving batches holding
    2-6 unlabelled each. Dispatching an annotator for 2 images wastes its whole
    startup, so the remainder is repacked into full units."""
    monkeypatch.setattr(q, "BATCH_SIZE", 5)
    rows = [{"image": f"{i}.jpg", "source": "s", "subject": str(i), "batch": i // 2}
            for i in range(20)]
    units = q.work_units(rows, done={f"{i}.jpg" for i in range(0, 20, 2)})  # half labelled
    assert [len(u) for u in units] == [5, 5]
    assert [r["image"] for r in units[0]] == ["1.jpg", "3.jpg", "5.jpg", "7.jpg", "9.jpg"]


def test_work_units_never_split_a_subject(monkeypatch):
    monkeypatch.setattr(q, "BATCH_SIZE", 4)
    rows = [{"image": f"{s}-{a}.jpg", "source": "sd", "subject": s, "batch": 0}
            for s in ("a", "b", "c") for a in ("1", "2", "3")]
    units = q.work_units(rows, done=set())
    for s in ("a", "b", "c"):
        holding = [i for i, u in enumerate(units) if any(r["subject"] == s for r in u)]
        assert len(holding) == 1
