"""
Lesion inference pipeline: detect → segment (refine) → crop → classify.

    whole image
        │  YOLO detect (generic placeholder until a lesion-trained detector exists)
        ▼
    rough lesion box ── or ── whole image (fallback when nothing is detected)
        │  MobileSAM (optional — refines the box into a precise mask, only when
        │  a detection exists; never runs on the whole-image fallback, since
        │  there's no box to refine)
        ▼
    refined crop (or the raw detector box, if segmentation is unavailable, low
    quality, or fails)
        │  EfficientNet-B1 (ISIC/PAD-UFES 6-class)
        ▼
    structured result

Detector, segmenter, and classifier are all injected (defaults = the
ModelManager singletons), so tests run fast with fakes and never load real
weights.
"""
from __future__ import annotations

from pathlib import Path
from typing import Callable

from PIL import Image


# detect_fn:   PIL.Image -> [ {bbox:[x1,y1,x2,y2], confidence:float}, ... ]
# segment_fn:  PIL.Image, bbox -> {"mask_bbox":[x1,y1,x2,y2], "iou":float} | None
#   iou is MobileSAM's own predicted mask quality (SamPredictor.predict()'s score
#   output for the chosen mask) — a real per-mask confidence, not invented here.
# classify_fn: PIL.Image -> { label: prob, ... }  (sorted desc, like LesionClassifier)
DetectFn = Callable[[Image.Image], list[dict]]
SegmentFn = Callable[[Image.Image, list[float]], dict | None]
ClassifyFn = Callable[[Image.Image], dict]

CLASSIFIER_VERSION = "efficientnet_b1-isic2019"
DETECTOR_VERSION = "yolo11n-generic"  # NOT lesion-trained — placeholder
SEGMENTER_VERSION = "mobile_sam-vit_t"

# Below this predicted mask quality, treat the segmentation as a failure signal,
# not a refinement — keep the detector's own box/confidence instead. MobileSAM's
# own paper reports IoU as its mask-quality metric; this is a conservative floor,
# not a tuned value — revisit once real lesion photos are run through it.
MIN_SEGMENT_IOU = 0.5

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
    def __init__(
        self,
        detect_fn: DetectFn | None = None,
        segment_fn: SegmentFn | None = None,
        classify_fn: ClassifyFn | None = None,
    ):
        self._detect_fn = detect_fn
        self._segment_fn = segment_fn
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

    def _segment(self, image: Image.Image, bbox: list[float]) -> dict | None:
        if self._segment_fn is not None:
            return self._segment_fn(image, bbox)
        from ai.models.manager import models
        import numpy as np

        predictor = models.mobile_sam
        predictor.set_image(np.array(image))
        box = np.array(bbox)
        masks, scores, _ = predictor.predict(box=box, multimask_output=True)
        best = int(scores.argmax())
        mask = masks[best]
        ys, xs = np.where(mask)
        if len(xs) == 0 or len(ys) == 0:
            return None
        mask_bbox = [float(xs.min()), float(ys.min()), float(xs.max()), float(ys.max())]
        return {"mask_bbox": mask_bbox, "iou": float(scores[best])}

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
                bbox = d["bbox"]
                segmented = False
                localization_confidence = d["confidence"]

                try:
                    refined = self._segment(img, bbox)
                except Exception:
                    # Never let a segmentation failure break the pipeline — the
                    # detector's own box is always a safe fallback.
                    refined = None

                if refined is not None and refined["iou"] >= MIN_SEGMENT_IOU:
                    bbox = refined["mask_bbox"]
                    # A confirmed, precise mask is more trustworthy than an
                    # unverified rectangle — but never let a mediocre detector
                    # score be dragged down by a merely-adequate mask either;
                    # take whichever signal is more informative.
                    localization_confidence = max(d["confidence"], refined["iou"])
                    segmented = True

                x1, y1, x2, y2 = (int(v) for v in bbox)
                crop = img.crop((x1, y1, x2, y2))
                lesions.append({
                    "bbox": bbox,
                    "detector_confidence": d["confidence"],
                    "localization_confidence": localization_confidence,
                    "segmented": segmented,
                    "classification": _summarize(self._classify(crop)),
                })
            whole_image_fallback = False
        else:
            # Generic detector found nothing lesion-shaped → classify the whole
            # (already close-up) frame. Honest: no localization claimed. Nothing
            # to segment either — MobileSAM refines a detected box, it doesn't
            # find lesions on its own.
            lesions.append({
                "bbox": None,
                "detector_confidence": None,
                "localization_confidence": WHOLE_IMAGE_LOCALIZATION_CONFIDENCE,
                "segmented": False,
                "classification": _summarize(self._classify(img)),
            })
            whole_image_fallback = True

        return {
            "lesions": lesions,
            "whole_image_fallback": whole_image_fallback,
            "model": {
                "classifier": CLASSIFIER_VERSION,
                "detector": DETECTOR_VERSION,
                "segmenter": SEGMENTER_VERSION,
            },
        }


if __name__ == "__main__":
    import json
    import sys

    if len(sys.argv) < 2:
        print("Usage: python -m ai.inference.pipeline image.jpg")
        sys.exit(1)
    print(json.dumps(LesionPipeline().analyze(sys.argv[1]), indent=2))
