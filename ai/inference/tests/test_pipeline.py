from PIL import Image

from ai.inference.pipeline import LesionPipeline, _summarize


def _img(w=64, h=64):
    return Image.new("RGB", (w, h), (150, 120, 110))


def test_summarize_picks_top_and_keeps_three():
    s = _summarize({"MEL": 0.6, "NEV": 0.3, "BCC": 0.08, "SCC": 0.02})
    assert s["predicted"] == "MEL"
    assert s["confidence"] == 0.6
    assert len(s["top"]) == 3
    assert s["top"][0] == {"label": "MEL", "confidence": 0.6}


def test_analyze_classifies_each_detection():
    pipe = LesionPipeline(
        detect_fn=lambda img: [
            {"bbox": [0, 0, 20, 20], "confidence": 0.9},
            {"bbox": [30, 30, 50, 50], "confidence": 0.7},
        ],
        classify_fn=lambda crop: {"MEL": 0.8, "NEV": 0.2},
    )
    out = pipe.analyze(_img())
    assert out["whole_image_fallback"] is False
    assert len(out["lesions"]) == 2
    assert out["lesions"][0]["classification"]["predicted"] == "MEL"
    assert out["lesions"][0]["detector_confidence"] == 0.9


def test_analyze_falls_back_to_whole_image_when_no_detections():
    seen = {}

    def classify(crop):
        seen["size"] = crop.size
        return {"NEV": 0.7, "SEK": 0.3}

    pipe = LesionPipeline(detect_fn=lambda img: [], classify_fn=classify)
    out = pipe.analyze(_img(64, 48))
    assert out["whole_image_fallback"] is True
    assert len(out["lesions"]) == 1
    assert out["lesions"][0]["bbox"] is None
    assert seen["size"] == (64, 48)          # whole frame classified, not a crop
    assert out["model"]["classifier"] == "efficientnet_b1-isic2019"


def test_analyze_reports_high_localization_confidence_for_a_real_detection():
    pipe = LesionPipeline(
        detect_fn=lambda img: [{"bbox": [0, 0, 20, 20], "confidence": 0.9}],
        classify_fn=lambda crop: {"MEL": 0.8, "NEV": 0.2},
    )
    out = pipe.analyze(_img())
    assert out["lesions"][0]["localization_confidence"] == 0.9  # == detector's own confidence


def test_analyze_reports_low_localization_confidence_on_whole_image_fallback():
    pipe = LesionPipeline(detect_fn=lambda img: [], classify_fn=lambda crop: {"NEV": 0.7})
    out = pipe.analyze(_img())
    assert out["whole_image_fallback"] is True
    # Low, not zero: the classifier still ran and may still be informative — this
    # is a caveat about localization, not a claim the classification is worthless.
    assert 0 < out["lesions"][0]["localization_confidence"] <= 0.3


def test_localization_confidence_never_changes_the_classification_confidence():
    # Safety invariant: hasMalignantSignal() (shared/lesion.ts) reads
    # classification.confidence/top[].confidence directly. localization_confidence
    # must be a fully separate field -- never blended into those numbers, or a
    # malignant-leaning whole-image fallback could silently drop under the
    # mandatory-referral floor.
    pipe = LesionPipeline(detect_fn=lambda img: [], classify_fn=lambda crop: {"MEL": 0.6, "NEV": 0.4})
    out = pipe.analyze(_img())
    assert out["lesions"][0]["classification"]["confidence"] == 0.6
    assert out["lesions"][0]["classification"]["top"][0] == {"label": "MEL", "confidence": 0.6}


def test_analyze_crops_to_the_detected_box():
    crops = []
    pipe = LesionPipeline(
        detect_fn=lambda img: [{"bbox": [10, 10, 40, 30], "confidence": 0.5}],
        classify_fn=lambda crop: (crops.append(crop.size) or {"BCC": 1.0}),
    )
    pipe.analyze(_img(64, 64))
    assert crops == [(30, 20)]                # (x2-x1, y2-y1)
