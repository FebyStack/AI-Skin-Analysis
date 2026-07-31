"""Severity vocabulary shared by every non-acne, non-skintype dimension.

Kept identical to SEVERITY_LEVELS in shared/training-queue.ts — the clinician
grades against that list, the backend exports folders named after it, and this
reads those folders back. If the two ever drift, training silently loses rows.
"""
from __future__ import annotations

SEVERITY_CLASSES: list[str] = ["none", "mild", "moderate", "severe"]

# Tolerated spellings from external datasets. Clinic exports are already exact.
_ALIASES = {
    "clear": "none",
    "absent": "none",
    "minimal": "mild",
    "slight": "mild",
    "light": "mild",
    "medium": "moderate",
    "marked": "severe",
    "very-severe": "severe",
}


def normalize_severity(name: str) -> str | None:
    key = name.strip().lower().replace("_", "-").replace(" ", "-")
    if key in SEVERITY_CLASSES:
        return key
    return _ALIASES.get(key)
