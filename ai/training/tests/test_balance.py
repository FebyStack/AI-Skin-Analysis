import pytest

from ai.training.dimension.balance import MAX_TV_DISTANCE, source_skew, tv_distance


def test_identical_source_mixes_score_zero():
    assert tv_distance({"a": 10, "b": 10}, {"a": 20, "b": 20}) == 0.0


def test_disjoint_corpora_score_one():
    """Positives from one corpus and negatives from another — the exact shape
    that scored four dimension models 0.96-1.00 before they were deleted."""
    assert tv_distance({"multi": 40}, {"acnegrading": 40}) == 1.0


def test_an_empty_class_is_maximally_skewed_not_zero():
    """No negatives at all must never read as 'perfectly balanced'."""
    assert tv_distance({"multi": 40}, {}) == 1.0


def test_source_skew_flags_the_dimension_and_names_the_mix():
    records = (
        [{"image": f"p{i}.jpg", "labels": {"redness": "present"}, "quality": "ok"} for i in range(20)]
        + [{"image": f"a{i}.jpg", "labels": {"redness": "absent"}, "quality": "ok"} for i in range(20)]
    )
    source_of = {**{f"p{i}.jpg": "multi" for i in range(20)},
                 **{f"a{i}.jpg": "acnegrading" for i in range(20)}}

    out = source_skew("redness", records, source_of)

    assert out["tv_distance"] == 1.0
    assert out["ok"] is False
    assert out["mix"]["present"] == {"multi": 20}
    assert out["mix"]["absent"] == {"acnegrading": 20}


def test_a_well_mixed_dimension_passes():
    records, source_of = [], {}
    for i in range(20):
        for label in ("present", "absent"):
            for src in ("multi", "acnegrading"):
                key = f"{label}{src}{i}.jpg"
                records.append({"image": key, "labels": {"redness": label}, "quality": "ok"})
                source_of[key] = src
    out = source_skew("redness", records, source_of)
    assert out["tv_distance"] == 0.0 and out["ok"] is True


def test_uncertain_and_bad_quality_rows_are_excluded_from_the_check():
    """They never reach training, so counting them would hide real skew."""
    records = [
        {"image": "a.jpg", "labels": {"redness": "present"}, "uncertain": ["redness"], "quality": "ok"},
        {"image": "b.jpg", "labels": {"redness": "present"}, "quality": "blurry"},
    ]
    out = source_skew("redness", records, {"a.jpg": "multi", "b.jpg": "multi"})
    assert out["mix"] == {}
    assert out["insufficient"] is True  # no verdict, rather than a pass


def test_a_thin_class_yields_no_verdict_rather_than_a_block():
    """With three positives the mix is whichever corpus supplied them. Blocking
    on that noise teaches people to pass --allow-skew reflexively."""
    records = [{"image": f"p{i}.jpg", "labels": {"redness": "present"}, "quality": "ok"} for i in range(3)]
    records += [{"image": f"a{i}.jpg", "labels": {"redness": "absent"}, "quality": "ok"} for i in range(30)]
    src = {**{f"p{i}.jpg": "multi" for i in range(3)}, **{f"a{i}.jpg": "acnegrading" for i in range(30)}}
    out = source_skew("redness", records, src)
    assert out["tv_distance"] == 1.0      # genuinely disjoint...
    assert out["insufficient"] is True    # ...but on 3 positives that means nothing
    assert out["ok"] is True              # so it must not block yet


def test_threshold_is_a_stated_constant_not_a_magic_number():
    assert 0 < MAX_TV_DISTANCE < 1
