import json
from pathlib import Path

from ai.training.dimension.materialize import materialize, validate_record


def _rec(**over):
    rec = {
        "image": "redness/scans/mild/a.jpg",
        "labels": {"acne": "mild", "redness": "present", "pores": "absent"},
        "uncertain": ["pores"],
        "quality": "ok",
    }
    rec.update(over)
    return rec


def test_valid_record_passes():
    assert validate_record(_rec()) == []


def test_invalid_vocab_rejected_loudly():
    errs = validate_record(_rec(labels={"redness": "mild"}))
    assert errs and "redness" in errs[0]


def test_unknown_attribute_rejected():
    assert validate_record(_rec(labels={"blemish": "present"}))


def test_bad_quality_value_rejected():
    assert validate_record(_rec(quality="fuzzy"))


def test_materialize_links_confident_ok_labels_only(tmp_path, monkeypatch):
    monkeypatch.setenv("DATASETS_DIR", str(tmp_path))
    src = tmp_path / "redness" / "scans" / "mild"
    src.mkdir(parents=True)
    (src / "a.jpg").write_bytes(b"fake")
    jsonl = tmp_path / "batch.jsonl"
    lines = [
        _rec(),  # ok: acne+redness land, pores skipped (uncertain)
        _rec(image="redness/scans/mild/a.jpg", quality="blurry"),  # dropped
        {"image": "missing.jpg", "labels": {"redness": "mild"}, "quality": "ok"},  # invalid
    ]
    jsonl.write_text("\n".join(json.dumps(r) for r in lines))

    report = materialize(jsonl, source="auto")

    # No manifest here, so the link name falls back to the flattened source path.
    link = "redness__scans__mild__a.jpg"
    assert (tmp_path / "redness" / "auto" / "present" / link).exists()
    assert not (tmp_path / "pores" / "auto" / "absent" / link).exists()  # uncertain
    assert not (tmp_path / "acne").exists()  # gated
    assert report["linked"] == 1
    assert report["skipped_uncertain"] == 1
    assert report["skipped_gated"] == 1
    assert report["dropped_quality"] == 1
    assert len(report["invalid"]) == 1 and "line 3" in report["invalid"][0]


def test_link_names_cannot_collide_across_subjects(tmp_path, monkeypatch):
    """28 subjects each ship a `front.jpg`. Naming links by basename silently
    dropped 27 of them, because an existing dest is treated as already-done."""
    monkeypatch.setenv("DATASETS_DIR", str(tmp_path))
    manifest = tmp_path / "_labels" / "manifest.jsonl"
    manifest.parent.mkdir(parents=True)
    recs, man = [], []
    for subj in ("acne-1", "acne-2"):
        rel = f"_incoming/skin-defects/files/{subj.replace('-', '/')}/front.jpg"
        src = tmp_path / rel
        src.parent.mkdir(parents=True, exist_ok=True)
        src.write_bytes(subj.encode())
        man.append({"image": rel, "source": "skindefects", "subject": subj})
        recs.append({"image": rel, "labels": {"redness": "present"}, "quality": "ok"})
    manifest.write_text("\n".join(json.dumps(r) for r in man))
    jsonl = tmp_path / "b.jsonl"
    jsonl.write_text("\n".join(json.dumps(r) for r in recs))

    # allow_skew: this fixture is all-`present` by design, which the balance
    # guard rightly rejects. The behaviour under test here is link naming.
    report = materialize(jsonl, source="auto", allow_skew=True)

    linked = sorted(p.name for p in (tmp_path / "redness" / "auto" / "present").iterdir())
    assert report["linked"] == 2
    assert linked == ["skindefects__acne-1__front.jpg", "skindefects__acne-2__front.jpg"]


def test_acne_and_skintype_need_explicit_opt_in(tmp_path, monkeypatch):
    """Their ingest reads every source dir with no gate, so writing AI labels
    into acne/auto/ would silently join the two models that actually work."""
    monkeypatch.setenv("DATASETS_DIR", str(tmp_path))
    src = tmp_path / "s"
    src.mkdir()
    (src / "a.jpg").write_bytes(b"x")
    jsonl = tmp_path / "b.jsonl"
    jsonl.write_text(
        json.dumps({"image": "s/a.jpg", "labels": {"acne": "mild", "redness": "present"}, "quality": "ok"})
    )

    report = materialize(jsonl, source="auto")
    assert report["linked"] == 1
    assert report["skipped_gated"] == 1
    assert not (tmp_path / "acne").exists()

    materialize(jsonl, source="auto", include_trained=True)
    assert (tmp_path / "acne" / "auto" / "mild").exists()


def test_source_skewed_dimension_is_refused(tmp_path, monkeypatch):
    """Positives from one corpus and negatives from another is the confound that
    deleted four models. It must not reach <dim>/auto/ just because the labels
    themselves are well-formed."""
    monkeypatch.setenv("DATASETS_DIR", str(tmp_path))
    manifest = tmp_path / "_labels" / "manifest.jsonl"
    manifest.parent.mkdir(parents=True)
    man, recs = [], []
    for i in range(10):
        for label, src in (("present", "multi"), ("absent", "acnegrading")):
            rel = f"{src}/{label}{i}.jpg"
            p = tmp_path / rel
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_bytes(b"x")
            man.append({"image": rel, "source": src, "subject": f"{label}{i}"})
            recs.append({"image": rel, "labels": {"redness": label}, "quality": "ok"})
    manifest.write_text("\n".join(json.dumps(r) for r in man))
    jsonl = tmp_path / "b.jsonl"
    jsonl.write_text("\n".join(json.dumps(r) for r in recs))

    report = materialize(jsonl, source="auto")

    assert report["linked"] == 0
    assert "redness" in report["skewed"]
    assert not (tmp_path / "redness" / "auto").exists()

    forced = materialize(jsonl, source="auto", allow_skew=True)
    assert forced["linked"] == 20


def test_materialize_is_idempotent(tmp_path, monkeypatch):
    monkeypatch.setenv("DATASETS_DIR", str(tmp_path))
    src = tmp_path / "redness" / "scans" / "mild"
    src.mkdir(parents=True)
    (src / "a.jpg").write_bytes(b"fake")
    jsonl = tmp_path / "batch.jsonl"
    jsonl.write_text(json.dumps(_rec()))
    materialize(jsonl, source="auto")
    report = materialize(jsonl, source="auto")
    assert report["linked"] == 0  # already there, not duplicated
