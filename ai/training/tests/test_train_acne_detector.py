from ai.training.localize.train_acne_detector import model_json


def test_model_json_records_contract_and_metrics():
    j = model_json("v1", {"test_map50": 0.61234, "test_recall": 0.5})
    assert j["preprocess"] == {"color_constancy": True, "letterbox_pad": 114}
    assert j["output"] == {"name": "output0", "rows": "x1,y1,x2,y2,score,class", "nms": True}
    assert j["metrics"] == {"test_map50": 0.6123, "test_recall": 0.5}
