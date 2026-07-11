# ai/training/tests/test_promote.py
import json
from pathlib import Path
from ai.training.promote import decide_promotion, promote

def _meta(f1, mel_sens):
    return {"metrics": {"val_macro_f1": f1, "melanoma_sensitivity": mel_sens}}

def test_promote_when_f1_up_and_melanoma_not_worse():
    ok, why = decide_promotion(_meta(0.80, 0.90), _meta(0.75, 0.90))
    assert ok is True

def test_block_when_melanoma_sensitivity_regresses():
    ok, why = decide_promotion(_meta(0.85, 0.70), _meta(0.75, 0.90))
    assert ok is False and "melanoma" in why.lower()

def test_block_when_no_production_metrics_missing():
    ok, why = decide_promotion(_meta(0.85, 0.90), None)  # first ever model
    assert ok is True and "first" in why.lower()

def test_block_when_candidate_metrics_incomplete():
    ok, why = decide_promotion({"metrics": {"val_macro_f1": 0.85}}, _meta(0.75, 0.90))
    assert ok is False and "incomplete" in why.lower()

def test_block_when_production_metrics_null():
    ok, why = decide_promotion(_meta(0.85, 0.90), {"metrics": None})
    assert ok is False and "incomplete" in why.lower()

def test_write_candidate_metrics_merges(tmp_path):
    from ai.training.evaluate import write_candidate_metrics
    (tmp_path / "model.json").write_text(json.dumps({"version": "1.1.0", "metrics": {"val_macro_f1": 0.8}}))
    write_candidate_metrics(tmp_path, {"melanoma_sensitivity": 0.9})
    meta = json.loads((tmp_path / "model.json").read_text())
    assert meta["metrics"] == {"val_macro_f1": 0.8, "melanoma_sensitivity": 0.9}
    assert meta["version"] == "1.1.0"

def test_promote_archives_old_never_overwrites(tmp_path):
    prod = tmp_path / "production"; cand = tmp_path / "candidate"; arch = tmp_path / "archive"
    for d, v in [(prod, "1.0.0"), (cand, "1.1.0")]:
        d.mkdir(parents=True); (d / "current.pt").write_text(v)
        (d / "model.json").write_text(json.dumps({"version": v}))
    promote(cand, prod, arch)
    assert (prod / "model.json").read_text().find("1.1.0") > -1     # candidate is now prod
    archived = list(arch.glob("*/model.json"))
    assert len(archived) == 1 and "1.0.0" in archived[0].read_text()  # old prod archived, not lost
