import json

from ai.training.localize.eval_marks import main, match, score

BOX = {"x": 0.1, "y": 0.1, "w": 0.2, "h": 0.2, "confidence": 0.9}


def test_point_in_box_matches_once():
    assert match([{"x": 0.2, "y": 0.2}, {"x": 0.15, "y": 0.15}], [BOX]) == 1
    assert match([{"x": 0.5, "y": 0.5}], [BOX]) == 0


def test_score_recall_precision_count_error():
    rows = [{"points": [{"x": 0.2, "y": 0.2}, {"x": 0.8, "y": 0.8}], "predictions": [BOX]}]
    s = score(rows)
    assert (s["recall"], s["precision"], s["count_mae"]) == (0.5, 1.0, 1.0)


def test_main_reports_not_yet_below_the_bar(tmp_path, capsys):
    row = {"points": [{"x": 0.2, "y": 0.2}], "predictions": [BOX], "device": "Clinic iPad 1"}
    (tmp_path / "marks.jsonl").write_text(json.dumps(row) + "\n")
    assert main([str(tmp_path)]) == 0
    out = capsys.readouterr().out
    assert "recall=1.00" in out and "Clinic iPad 1" in out and "NOT YET" in out
