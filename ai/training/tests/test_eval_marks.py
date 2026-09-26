import json

from ai.training.localize.eval_marks import MIN_PHOTOS, main, match, score

BOX = {"x": 0.1, "y": 0.1, "w": 0.2, "h": 0.2, "confidence": 0.9}


def test_point_in_box_matches_once():
    assert match([{"x": 0.2, "y": 0.2}, {"x": 0.15, "y": 0.15}], [BOX]) == 1
    assert match([{"x": 0.5, "y": 0.5}], [BOX]) == 0


def test_score_recall_precision_count_error():
    rows = [{"points": [{"x": 0.2, "y": 0.2}, {"x": 0.8, "y": 0.8}], "predictions": [BOX]}]
    s = score(rows)
    assert (s["recall"], s["precision"], s["count_mae"]) == (0.5, 1.0, 1.0)


def test_main_reports_not_yet_below_the_bar(tmp_path, capsys):
    row = {"points": [{"x": 0.2, "y": 0.2}], "predictions": [BOX], "device": "Clinic iPad 1", "model": "yolo11n-acne"}
    (tmp_path / "marks.jsonl").write_text(json.dumps(row) + "\n")
    assert main([str(tmp_path)]) == 0
    out = capsys.readouterr().out
    assert "recall=1.00" in out and "Clinic iPad 1" in out and "model=yolo11n-acne" in out and "NOT YET" in out


def test_never_passes_when_rows_come_from_more_than_one_model(tmp_path, capsys):
    # Enough photos and a perfect match to otherwise clear the PASS bar.
    rows = [
        {"points": [{"x": 0.2, "y": 0.2}], "predictions": [BOX], "model": "v1" if i % 2 == 0 else "v2"}
        for i in range(MIN_PHOTOS)
    ]
    (tmp_path / "marks.jsonl").write_text("\n".join(json.dumps(r) for r in rows) + "\n")
    assert main([str(tmp_path)]) == 0
    out = capsys.readouterr().out
    assert "model=v1" in out and "model=v2" in out
    assert "PASS —" not in out
