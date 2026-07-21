"""Acne severity labels — ordinal, 5 levels (index == severity).

Kept in sync with the browser analyzer (ai/face/analyzers/acne-model.ts) and the
scan-label vocabulary the backend accepts. Ordinal: 'moderate' is between 'mild'
and 'severe', which the evaluator exploits (MAE, not just accuracy).
"""

ACNE_CLASSES = ["clear", "mild", "moderate", "severe", "very-severe"]

# Common aliases from public datasets (ACNE04 grades 0-3, Hayashi, etc.) → canonical.
_ALIASES = {
    "0": "clear", "1": "mild", "2": "moderate", "3": "severe", "4": "very-severe",
    "level0": "clear", "level1": "mild", "level2": "moderate", "level3": "severe", "level4": "very-severe",
    "clear": "clear", "none": "clear",
    "mild": "mild", "comedonal": "mild",
    "moderate": "moderate",
    "severe": "severe",
    "very-severe": "very-severe", "very_severe": "very-severe", "nodulocystic": "very-severe",
}


def normalize_acne_label(raw: str) -> str | None:
    return _ALIASES.get(str(raw).strip().lower())
