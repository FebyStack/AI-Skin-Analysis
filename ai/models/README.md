# AI Models

Model weights live here but are **gitignored** (large binaries, provided out-of-band).
Re-download onto a fresh machine with:

```bash
.venv/bin/python -m ai.models.fetch_models          # all
.venv/bin/python -m ai.models.fetch_models classifier
```

| Dir | File | What | Source | Notes |
|---|---|---|---|---|
| `classifier/isic2019/` | `best_weights.pth` (25MB) | EfficientNet-B1, 6-class skin lesion (ACK, BCC, MEL, NEV, SCC, SEK) | HF `conan17970/efficientnet-b1-skin-cancer-isic2019` | timm; F1 0.688. **The production classifier.** |
| `detector/` | `yolo11n.pt` (5.4MB) | YOLO11-nano | Ultralytics v8.3.0 assets | Generic COCO weights — **not lesion-trained**; placeholder detector, see pipeline fallback |
| `segmentation/` | `mobile_sam.pt` (39MB) | MobileSAM | ChaoningZhang/MobileSAM | Wired into `ai/inference/pipeline.py` (refines a YOLO detection into a precise crop, gated on the mask's own predicted quality — never runs on the whole-image fallback). Requires the vendored `MobileSAM/` clone importable: `cd MobileSAM && pip install -e .`. **Logic verified via injected fakes (`ai/inference/tests/test_pipeline.py`) — the real-weights path (`ModelManager.mobile_sam`) has not been run end-to-end on an actual photo; verify manually before relying on it.** |
| `face/` or `frontend/public/models/` | `face_landmarker.task` | MediaPipe Face Landmarker | Google MediaPipe | Served to the browser at `/models/*` |

`MobileSAM/` at repo root is a vendored upstream clone (also gitignored) — `mobile-sam` is not published on PyPI under that name, so this is the actual install path (`cd MobileSAM && pip install -e .`), not a fallback.

Runtime code: `ai/inference/` (lesion classifier + pipeline). ModelManager: `ai/models/manager.py`.
