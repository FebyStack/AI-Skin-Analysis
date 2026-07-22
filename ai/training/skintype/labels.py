"""Skin-type labels — categorical (NOT ordinal), 4 classes.

Kept in sync with the browser analyzer (ai/face/analyzers/skintype-model.ts) and
the scan-label vocabulary the backend accepts. Unlike acne severity these have no
natural order, so the evaluator uses accuracy + macro-F1 (no MAE).
"""

SKIN_TYPE_CLASSES = ["normal", "oily", "dry", "combination"]

_ALIASES = {
    "normal": "normal",
    "oily": "oily", "oil": "oily",
    "dry": "dry", "dryness": "dry",
    "combination": "combination", "combo": "combination", "comb": "combination",
}


def normalize_skin_type(raw: str) -> str | None:
    return _ALIASES.get(str(raw).strip().lower())
