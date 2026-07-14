"""
Lesion inference pipeline: detect → crop → classify.

    whole image
        │  YOLO detect (generic placeholder until a lesion-trained detector exists)
        ▼
    lesion crops ── or ── whole image (fallback when nothing is detected)
        │  EfficientNet-B1 (ISIC/PAD-UFES 6-class)
        ▼
    structured result

Detector and classifier are injected (defaults = the ModelManager singletons),
so tests run fast with fakes and never load real weights.
"""
from __future__ import annotations

from pathlib import Path
from typing import Callable

from PIL import Image


# detect_fn:  PIL.Image -> [ {bbox:[x1,y1,x2,y2], confidence:float}, ... ]
# classify_fn: PIL.Image -> { label: prob, ... }  (sorted desc, like LesionClassifier)
DetectFn = Callable[[Image.Image], list[dict]]
ClassifyFn = Callable[[Image.Image], dict]

CLASSIFIER_VERSION = "efficientnet_b1-isic2019"
DETECTOR_VERSION = "yolo11n-generic"  # NOT lesion-trained — placeholder

# Honest caveat, not a real measurement: yolo11n-generic was never trained on
# lesion imagery, so it rarely fires on a lesion shape and analyze() usually
# falls through to classifying the whole, undifferentiated photo. That's a
# meaningfully different (weaker) situation than a real detected+cropped
# lesion, and callers (report builder, UI) should be able to tell the two
# apart -- without this being folded into classification.confidence, which
# hasMalignantSignal() (shared/lesion.ts) depends on for the mandatory-referral
# safety check. A single flat value keeps that promise legible and auditable.
WHOLE_IMAGE_LOCALIZATION_CONFIDENCE = 0.2


def _summarize(probs: dict) -> dict:
    items = list(probs.items())
    predicted, confidence = (items[0] if items else (None, 0.0))
    return {
        "predicted": predicted,
        "confidence": confidence,
        "top": [{"label": k, "confidence": v} for k, v in items[:3]],
    }


class LesionPipeline:
    def __init__(self, detect_fn: DetectFn | None = None, classify_fn: ClassifyFn | None = None):
        self._detect_fn = detect_fn
        self._classify_fn = classify_fn

    # ---- default deps (lazy — only load real models when no fake injected) ----
    def _detect(self, image: Image.Image) -> list[dict]:
        if self._detect_fn is not None:
            return self._detect_fn(image)
        from ai.models.manager import models

        boxes: list[dict] = []
        for r in models.yolo.predict(source=image, verbose=False):
            for b in r.boxes:
                boxes.append({
                    "bbox": [float(v) for v in b.xyxy[0].tolist()],
                    "confidence": float(b.conf[0]),
                })
        return boxes

    def _classify(self, image: Image.Image) -> dict:
        if self._classify_fn is not None:
            return self._classify_fn(image)
        from ai.models.manager import models

        return models.classifier.predict_image(image)

    # ---- pipeline ----
    def analyze(self, image: str | Path | Image.Image) -> dict:
        img = Image.open(image).convert("RGB") if isinstance(image, (str, Path)) else image.convert("RGB")
        detections = self._detect(img)

        lesions: list[dict] = []
        if detections:
            for d in detections:
                x1, y1, x2, y2 = (int(v) for v in d["bbox"])
                crop = img.crop((x1, y1, x2, y2))
                lesions.append({
                    "bbox": d["bbox"],
                    "detector_confidence": d["confidence"],
                    # A real detection: localization confidence is the detector's
                    # own confidence in that box actually being a lesion.
                    "localization_confidence": d["confidence"],
                    "classification": _summarize(self._classify(crop)),
                })
            whole_image_fallback = False
        else:
            # Generic detector found nothing lesion-shaped → classify the whole
            # (already close-up) frame. Honest: no localization claimed.
            lesions.append({
                "bbox": None,
                "detector_confidence": None,
                "localization_confidence": WHOLE_IMAGE_LOCALIZATION_CONFIDENCE,
                "classification": _summarize(self._classify(img)),
            })
            whole_image_fallback = True

        return {
            "lesions": lesions,
            "whole_image_fallback": whole_image_fallback,
            "model": {"classifier": CLASSIFIER_VERSION, "detector": DETECTOR_VERSION},
        }


if __name__ == "__main__":
    import json
    import sys

    if len(sys.argv) < 2:
        print("Usage: python -m ai.inference.pipeline image.jpg")
        sys.exit(1)
    print(json.dumps(LesionPipeline().analyze(sys.argv[1]), indent=2))
