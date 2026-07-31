"""Presence vocabulary shared by every non-acne, non-skintype dimension.

Identical to PRESENCE_LEVELS in shared/training-queue.ts. The clinician grades
against that list, the backend exports folders named after it, and this reads
those folders back — if the two drift, training silently loses rows.

Presence rather than severity because no public dataset grades these by degree,
and after months of grading the clinic held 43 none / 23 mild / 4 moderate /
0 severe. As four classes that is untrainable; as two it is 43/27.
"""
from __future__ import annotations

PRESENCE_CLASSES: list[str] = ["absent", "present"]

# Folder names already on disk from the retired severity scale, plus the
# spellings external datasets use. Anything visible at all counts as present, so
# no previously exported image is stranded.
_ALIASES = {
    "none": "absent",
    "clear": "absent",
    "no": "absent",
    "negative": "absent",
    "healthy": "absent",
    "normal": "absent",
    "mild": "present",
    "minimal": "present",
    "slight": "present",
    "light": "present",
    "moderate": "present",
    "medium": "present",
    "marked": "present",
    "severe": "present",
    "very-severe": "present",
    "yes": "present",
    "positive": "present",
}


def normalize_presence(name: str) -> str | None:
    key = name.strip().lower().replace("_", "-").replace(" ", "-")
    if key in PRESENCE_CLASSES:
        return key
    return _ALIASES.get(key)
