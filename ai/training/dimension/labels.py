"""Per-face-dimension model registry.

Each entry maps a FaceDimension (shared/face.ts FACE_DIMENSIONS) to its ordered
class list. Order matters: the browser turns class probabilities into the
dimension's 0..1 score via the ordinal expectation
    score = sum(p_i * i) / (len(classes) - 1)
so for binary ["absent", "present"] the score is exactly P(present), and for the
5-level acne scale it's expected severity. Adding a dimension = one entry here.
"""

PRESENCE_CLASSES = ["absent", "present"]

# Dimensions with a trainable model. acne keeps its 5-level ordinal scale
# (ai/training/acne) — everything here is presence/absence to match the data we
# have; upgrade a dimension to graded levels by listing them in order.
DIMENSION_CLASSES: dict[str, list[str]] = {
    "redness": PRESENCE_CLASSES,
    "wrinkles": PRESENCE_CLASSES,
    "pores": PRESENCE_CLASSES,
    "pigmentation": PRESENCE_CLASSES,
}

_ALIASES = {
    "absent": "absent", "none": "absent", "clear": "absent", "no": "absent", "0": "absent",
    "present": "present", "yes": "present", "1": "present",
}


def classes_for(dimension: str) -> list[str]:
    if dimension not in DIMENSION_CLASSES:
        raise KeyError(
            f"unknown dimension '{dimension}'. Known: {sorted(DIMENSION_CLASSES)}"
        )
    return DIMENSION_CLASSES[dimension]


def normalize_label(dimension: str, raw: str) -> str | None:
    """Folder/CSV label → canonical class for this dimension (None if unusable)."""
    valid = set(classes_for(dimension))
    key = str(raw).strip().lower()
    if key in valid:
        return key
    mapped = _ALIASES.get(key)
    return mapped if mapped in valid else None
