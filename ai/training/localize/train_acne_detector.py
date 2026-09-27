"""Train the one-class acne-lesion detector and export it for the browser.

    .venv.nosync/bin/python -m ai.training.localize.train_acne_detector DATA_YAML [--epochs 60]

Output: ai/models/acne-detector/candidate/{best.pt, model.onnx, model.json}.
ONNX contract (verified 2026-09-26, ultralytics 8.4.92, nms=True): input `images` [1,3,640,640]
RGB 0..1 letterboxed with grey 114; output `output0` [1,300,6] rows x1,y1,x2,y2,score,class in
640-px letterbox space, unused rows zero. The browser applies the confidence floor.
"""
from __future__ import annotations

import argparse
import json
import shutil
from datetime import datetime, timezone
from pathlib import Path

OUT = Path("ai/models/acne-detector/candidate")
BASE = Path("ai/models/detector/yolo11n.pt")


def model_json(version: str, metrics: dict[str, float]) -> dict:
    return {
        "name": "yolo11n-acne", "version": version, "classes": ["acne"], "img_size": 640,
        "preprocess": {"color_constancy": True, "letterbox_pad": 114},
        "output": {"name": "output0", "rows": "x1,y1,x2,y2,score,class", "nms": True},
        "metrics": {k: round(float(v), 4) for k, v in metrics.items()},
    }


def main(argv: list[str] | None = None) -> int:
    from ultralytics import YOLO  # heavy import kept out of the unit tests

    ap = argparse.ArgumentParser()
    ap.add_argument("data")
    ap.add_argument("--epochs", type=int, default=60)
    args = ap.parse_args(argv)
    version = f"acne-det-{datetime.now(timezone.utc).strftime('%Y%m%d-%H%M%S')}"

    model = YOLO(str(BASE))
    # Mild colour augmentation only: redness is part of the signal (see ai/training/transforms.py).
    # Absolute: ultralytics joins a relative project onto its global runs_dir (not this repo).
    model.train(data=args.data, imgsz=640, epochs=args.epochs, patience=15, batch=16, device="mps",
                hsv_h=0.0, hsv_s=0.3, hsv_v=0.3, project=str(Path("ai/models/acne-detector/runs").resolve()), name=version)
    weights = Path(model.trainer.save_dir) / "weights" / "best.pt"
    best = YOLO(str(weights))
    m = best.val(data=args.data, split="test", imgsz=640, verbose=False)
    metrics = {"test_map50": m.box.map50, "test_precision": m.box.mp, "test_recall": m.box.mr}

    OUT.mkdir(parents=True, exist_ok=True)
    shutil.copy(weights, OUT / "best.pt")
    onnx = best.export(format="onnx", imgsz=640, nms=True, conf=0.10, simplify=True)
    shutil.move(onnx, OUT / "model.onnx")
    (OUT / "model.json").write_text(json.dumps(model_json(version, metrics), indent=2))
    print(f"{version}: {metrics} -> {OUT}")
    print("If this candidate replaces a shipped model, bump CACHE_V in frontend/public/sw.js "
          "and rebuild — installed PWAs cache /models/* cache-first and would otherwise keep the old one.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
