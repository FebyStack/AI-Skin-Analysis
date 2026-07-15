from PIL import Image

from ai.inference.pipeline import LesionPipeline, _summarize


def _img(w=64, h=64):
    return Image.new("RGB", (w, h), (150, 120, 110))


# segment_fn: PIL.Image, bbox -> {"mask_bbox": [x1,y1,x2,y2], "iou": float} | None
# iou is MobileSAM's own predicted mask quality (SamPredictor.predict()'s scores
# output) — a real per-mask confidence, not a guess this pipeline invents.


def test_without_segment_fn_behavior_is_unchanged():
    # No segmentation configured (the default today) -> crops to the raw detector
    # bbox exactly as before, no regression for anyone not opting in.
    pipe = LesionPipeline(
        detect_fn=lambda img: [{"bbox": [0, 0, 20, 20], "confidence": 0.9}],
        classify_fn=lambda crop: {"MEL": 0.8, "NEV": 0.2},
    )
    out = pipe.analyze(_img())
    assert out["lesions"][0]["bbox"] == [0, 0, 20, 20]
    assert out["lesions"][0]["localization_confidence"] == 0.9


def test_segment_fn_refines_the_crop_and_raises_localization_confidence():
    # MobileSAM finds a tighter, high-confidence mask inside the detector's rough
    # box -> classify on the refined crop, and trust localization MORE than the
    # detector alone (a confirmed, precise region beats an unverified rectangle).
    pipe = LesionPipeline(
        detect_fn=lambda img: [{"bbox": [0, 0, 40, 40], "confidence": 0.6}],
        segment_fn=lambda img, bbox: {"mask_bbox": [5, 5, 20, 20], "iou": 0.95},
        classify_fn=lambda crop: {"MEL": 0.7, "NEV": 0.3},
    )
    out = pipe.analyze(_img())
    lesion = out["lesions"][0]
    assert lesion["bbox"] == [5, 5, 20, 20]  # refined, not the original rough box
    assert lesion["localization_confidence"] > 0.6  # raised above the raw detector confidence
    assert lesion["segmented"] is True


def test_low_quality_mask_does_not_raise_confidence_or_replace_the_crop():
    # A low predicted-IoU mask is a MobileSAM failure signal, not a refinement --
    # keep the detector's own box and confidence rather than trust a bad mask.
    pipe = LesionPipeline(
        detect_fn=lambda img: [{"bbox": [0, 0, 40, 40], "confidence": 0.6}],
        segment_fn=lambda img, bbox: {"mask_bbox": [1, 1, 39, 39], "iou": 0.2},
        classify_fn=lambda crop: {"NEV": 0.9},
    )
    out = pipe.analyze(_img())
    lesion = out["lesions"][0]
    assert lesion["bbox"] == [0, 0, 40, 40]
    assert lesion["localization_confidence"] == 0.6
    assert lesion["segmented"] is False


def test_segment_fn_is_never_called_on_whole_image_fallback():
    # Nothing to refine when there's no detection to refine -- segmentation only
    # ever runs on an already-detected box, never on the raw whole photo.
    calls = []
    pipe = LesionPipeline(
        detect_fn=lambda img: [],
        segment_fn=lambda img, bbox: calls.append(bbox) or {"mask_bbox": bbox, "iou": 0.9},
        classify_fn=lambda crop: {"NEV": 0.5},
    )
    out = pipe.analyze(_img())
    assert calls == []
    assert out["whole_image_fallback"] is True
    assert out["lesions"][0]["segmented"] is False


def test_segment_fn_failure_falls_back_to_the_detector_box_without_crashing():
    def boom(img, bbox):
        raise RuntimeError("mobile_sam blew up")

    pipe = LesionPipeline(
        detect_fn=lambda img: [{"bbox": [0, 0, 20, 20], "confidence": 0.8}],
        segment_fn=boom,
        classify_fn=lambda crop: {"NEV": 0.5},
    )
    out = pipe.analyze(_img())
    lesion = out["lesions"][0]
    assert lesion["bbox"] == [0, 0, 20, 20]
    assert lesion["localization_confidence"] == 0.8
    assert lesion["segmented"] is False


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
