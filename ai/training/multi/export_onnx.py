"""Export the multi-head face model to ONNX for the PWA.

    .venv/bin/python -m ai.training.multi.export_onnx

One file with one output per task (logits_<task>), so the browser loads a single
~15MB model and gets every prediction from one forward pass.
Output → frontend/public/models/face/.
"""
from __future__ import annotations

import json
from pathlib import Path

import torch

from ai.training.multi.model import MultiHeadNet, output_names

MODEL_DIR = Path("ai/models/face/candidate")
DEST = Path("frontend/public/models/face")


def main() -> int:
    meta = json.loads((MODEL_DIR / "model.json").read_text())
    net = MultiHeadNet(pretrained=False)
    net.load_state_dict(torch.load(MODEL_DIR / "current.pt", map_location="cpu", weights_only=True))
    net.eval()

    DEST.mkdir(parents=True, exist_ok=True)
    onnx_path = DEST / "model.onnx"
    names = output_names()
    torch.onnx.export(
        net,
        torch.randn(1, 3, 224, 224),
        str(onnx_path),
        input_names=["input"],
        output_names=names,
        dynamic_axes={"input": {0: "batch"}, **{n: {0: "batch"} for n in names}},
        opset_version=17,
        dynamo=False,
    )
    (DEST / "model.json").write_text(json.dumps(meta, indent=2))
    print(f"exported {meta['version']} → {onnx_path} "
          f"({onnx_path.stat().st_size // 1_000_000} MB), outputs: {names}")
    print("Browser picks it up at /models/face/model.onnx on next load.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
