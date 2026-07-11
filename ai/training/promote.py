# ai/training/promote.py
"""Gated promotion. Promote candidate ONLY if macro-F1 improves AND melanoma sensitivity does not
regress. Old production is ARCHIVED (timestamped), never overwritten."""
import json
import shutil
from datetime import datetime, timezone
from pathlib import Path

def decide_promotion(candidate_meta: dict, production_meta: dict | None) -> tuple[bool, str]:
    c = candidate_meta["metrics"]
    if production_meta is None:
        return True, "No production model yet — promoting the first model."
    p = production_meta["metrics"]
    if c["melanoma_sensitivity"] < p["melanoma_sensitivity"] - 1e-9:
        return False, f"Blocked: melanoma sensitivity regressed {p['melanoma_sensitivity']:.3f} → {c['melanoma_sensitivity']:.3f}."
    if c["val_macro_f1"] <= p["val_macro_f1"]:
        return False, f"Blocked: macro-F1 did not improve ({p['val_macro_f1']:.3f} → {c['val_macro_f1']:.3f})."
    return True, f"Promote: macro-F1 {p['val_macro_f1']:.3f} → {c['val_macro_f1']:.3f}, melanoma sens ≥ prior."

def promote(candidate: Path, production: Path, archive: Path) -> Path:
    archive.mkdir(parents=True, exist_ok=True)
    if (production / "model.json").exists():
        stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
        dest = archive / stamp
        shutil.copytree(production, dest)
    shutil.rmtree(production, ignore_errors=True)
    shutil.copytree(candidate, production)
    return production
