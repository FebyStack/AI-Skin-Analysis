"""Export a trained face-dimension model to ONNX for in-browser use.

    .venv/bin/python -m ai.training.dimension.export_onnx --dim redness

Writes frontend/public/models/<dim>/{model.onnx,model.json}. The browser picks it
up on next load and that dimension switches from pixel-math to the learned model.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import torch
from torchvision.models import efficientnet_b0

from ai.training.dimension.labels import DIMENSION_CLASSES


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dim", required=True, choices=sorted(DIMENSION_CLASSES))
    args = ap.parse_args(argv)

    dim = args.dim
    model_dir = Path(f"ai/models/{dim}/candidate")
    dest = Path(f"frontend/public/models/{dim}")

    meta = json.loads((model_dir / "model.json").read_text())
    net = efficientnet_b0(num_classes=len(meta["classes"]))
    net.load_state_dict(torch.load(model_dir / "current.pt", map_location="cpu", weights_only=True))
    net.eval()

    dest.mkdir(parents=True, exist_ok=True)
    onnx_path = dest / "model.onnx"
    torch.onnx.export(
        net,
        torch.randn(1, 3, 224, 224),
        str(onnx_path),
        input_names=["input"],
        output_names=["logits"],
        dynamic_axes={"input": {0: "batch"}, "logits": {0: "batch"}},
        opset_version=17,
        dynamo=False,  # legacy exporter: stable with dynamic_axes
    )
    (dest / "model.json").write_text(json.dumps(meta, indent=2))
    print(f"exported {meta['version']} → {onnx_path} ({onnx_path.stat().st_size // 1_000_000} MB)")
    print(f"Browser picks it up at /models/{dim}/model.onnx on next load.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
