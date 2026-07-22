"""Export a trained acne EfficientNet-B0 checkpoint to ONNX for in-browser use.

    .venv/bin/python -m ai.training.acne.export_onnx                        # candidate → frontend
    .venv/bin/python -m ai.training.acne.export_onnx --model-dir ai/models/acne/production

Writes model.onnx (opset 17, 1x3x224x224 input, dynamic batch) + copies model.json
next to it so the browser knows the class order. Output lands where the browser
serves it: frontend/public/models/acne/.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import torch
from torchvision.models import efficientnet_b0

DEFAULT_SRC = Path("ai/models/acne/candidate")
DEST_DIR = Path("frontend/public/models/acne")


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--model-dir", type=Path, default=DEFAULT_SRC)
    args = ap.parse_args(argv)

    meta = json.loads((args.model_dir / "model.json").read_text())
    classes = meta["classes"]
    net = efficientnet_b0(num_classes=len(classes))
    # weights_only=True: refuse pickled code on load.
    net.load_state_dict(torch.load(args.model_dir / "current.pt", map_location="cpu", weights_only=True))
    net.eval()

    DEST_DIR.mkdir(parents=True, exist_ok=True)
    dummy = torch.randn(1, 3, 224, 224)
    onnx_path = DEST_DIR / "model.onnx"
    torch.onnx.export(
        net,
        dummy,
        str(onnx_path),
        input_names=["input"],
        output_names=["logits"],
        dynamic_axes={"input": {0: "batch"}, "logits": {0: "batch"}},
        opset_version=17,
        dynamo=False,  # legacy TorchScript exporter: stable with dynamic_axes, no onnxscript path
    )
    (DEST_DIR / "model.json").write_text(json.dumps(meta, indent=2))
    print(f"exported {meta['version']} → {onnx_path} ({onnx_path.stat().st_size // 1_000_000} MB)")
    print("Browser will pick it up at /models/acne/model.onnx on next load.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
