import pytest

from ai.training.promote import CHANCE_MARGIN, near_chance_tasks


def _meta(**f1):
    return {
        "tasks": {"acne": ["clear", "mild", "moderate", "severe", "very-severe"],
                  "skintype": ["normal", "oily", "dry", "combination"]},
        "metrics": {f"val_macro_f1_{k}": v for k, v in f1.items()},
    }


def test_a_head_at_chance_is_flagged():
    """skintype scored 0.328 over 4 classes — chance is 0.25. Shipping it would
    put a real confidence in the UI behind a coin flip."""
    assert near_chance_tasks(_meta(acne=0.786, skintype=0.328)) == ["skintype"]


def test_a_genuinely_good_head_passes():
    assert near_chance_tasks(_meta(acne=0.786, skintype=0.61)) == []


def test_the_margin_is_measured_from_each_tasks_own_class_count():
    """5-class acne has a 0.20 floor, 4-class skintype 0.25 — a single absolute
    threshold would mis-gate one of them."""
    assert near_chance_tasks(_meta(acne=0.20 + CHANCE_MARGIN + 0.01, skintype=0.25 + CHANCE_MARGIN + 0.01)) == []
    assert near_chance_tasks(_meta(acne=0.28, skintype=0.61)) == ["acne"]


def test_a_missing_metric_is_flagged_not_assumed_good():
    assert near_chance_tasks(_meta(acne=0.786)) == ["skintype"]
