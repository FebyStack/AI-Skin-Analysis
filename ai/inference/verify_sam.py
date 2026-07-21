"""Real-weights MobileSAM + EfficientNet sanity check.

Run in a normal terminal (torch import hangs under some sandboxed shells):

    cd "/Users/febrielotud/Desktop/Skin analysis"
    .venv/bin/python -m ai.inference.verify_sam

Requires the vendored clone installed: `cd MobileSAM && pip install -e .`
(see ai/models/README.md), plus the classifier + segmentation weights present
(`.venv/bin/python -m ai.models.fetch_models`).

Generic YOLO rarely fires on a lesion, so we inject a rough detect box around a
synthetic dark 'lesion' blob — the REAL MobileSAM weights then refine it and the
REAL EfficientNet-B1 classifies the crop. Verifies the detect→segment→classify
path end-to-end without depending on the untrained detector actually firing.
"""
import json

import numpy as np
from PIL import Image, ImageDraw

from ai.inference.pipeline import LesionPipeline

W = H = 480
img = Image.new("RGB", (W, H), (196, 152, 128))
rng = np.random.default_rng(7)
arr = np.array(img, dtype=np.int16) + rng.integers(-14, 14, (H, W, 3), dtype=np.int16)
img = Image.fromarray(arr.clip(0, 255).astype(np.uint8))
draw = ImageDraw.Draw(img)
draw.ellipse([200, 190, 290, 300], fill=(88, 54, 44))
draw.ellipse([250, 210, 310, 280], fill=(74, 47, 40))

LOOSE_BOX = [160.0, 150.0, 340.0, 340.0]

# detect injected; segment + classify use the REAL ModelManager singletons.
pipe = LesionPipeline(detect_fn=lambda _img: [{"bbox": LOOSE_BOX, "confidence": 0.6}])
result = pipe.analyze(img)
lesion = result["lesions"][0]

print(json.dumps(result, indent=2)[:1200])
print("\n── verdicts ──")
print("segmented:", lesion["segmented"])
print("bbox refined:", lesion["bbox"] != LOOSE_BOX)
print("localization_confidence:", lesion["localization_confidence"])
if lesion["segmented"]:
    x1, y1, x2, y2 = lesion["bbox"]
    inside = 160 <= x1 and 150 <= y1 and x2 <= 340 and y2 <= 340
    tight = (x2 - x1) < (LOOSE_BOX[2] - LOOSE_BOX[0])
    print("mask inside loose box:", inside, "| tighter:", tight)
    print("SAM_REAL_WEIGHTS:", "PASS" if inside and tight else "SUSPECT — inspect JSON above")
else:
    print("SAM_REAL_WEIGHTS: mask below IoU floor or errored → fell back to detector box (see JSON)")
