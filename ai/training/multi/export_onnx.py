"""Export the multi-head face model to ONNX for the PWA.

    .venv/bin/python -m ai.training.multi.export_onnx

One file with one output per task (logits_<task>), so the browser loads a single
~15MB model and gets every prediction from one forward pass.
Output → frontend/public/models/face/.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import torch

from ai.training.multi.model import MultiHeadNet, output_names
from ai.training.promote import near_chance_tasks
from ai.training.transforms import NORM

MODEL_DIR = Path("ai/models/face/candidate")
DEST = Path("frontend/public/models/face")


class ColorConstancyInGraph(torch.nn.Module):
    """Shades-of-Grey inside the exported graph, for models trained with it.

    The browser (ai/face/analyzers/face-model.ts) feeds mean/std-normalised 224px pixels.
    Undo that, divide out the illuminant exactly as transforms.shades_of_gray does, and
    re-normalise — so the PWA needs no preprocessing change and cannot drift from training.
    """

    def __init__(self, net: torch.nn.Module, p: int = 6):
        super().__init__()
        self.net, self.p = net, p
        self.register_buffer("mean", torch.tensor(NORM["mean"]).view(1, 3, 1, 1))
        self.register_buffer("std", torch.tensor(NORM["std"]).view(1, 3, 1, 1))

    def forward(self, x: torch.Tensor):
        rgb = (x * self.std + self.mean).clamp(0, 1) * 255
        illum = rgb.pow(self.p).mean(dim=(2, 3), keepdim=True).pow(1.0 / self.p)
        illum = illum / (illum.pow(2).sum(dim=1, keepdim=True).sqrt() + 1e-6)
        rgb = (rgb / (illum * 3 ** 0.5)).clamp(0, 255)
        return self.net((rgb / 255 - self.mean) / self.std)


class KeepHeads(torch.nn.Module):
    """Export only some heads. The PWA reads outputs by name, so a missing head simply
    leaves its rule-based estimate in place (ai/face/analyzers/face-model.ts)."""

    def __init__(self, net: torch.nn.Module, keep: list[int]):
        super().__init__()
        self.net, self.keep = net, keep

    def forward(self, x: torch.Tensor):
        out = self.net(x)
        return tuple(out[i] for i in self.keep)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--force", action="store_true",
                    help="export even if a head scores near chance (it will ship to users)")
    ap.add_argument("--drop-task", action="append", default=[], metavar="TASK",
                    help="leave a head out of the export (repeatable), e.g. a near-chance skintype")
    ap.add_argument("--dest", type=Path, default=DEST,
                    help="output dir (default: the PWA's served models dir)")
    args = ap.parse_args()

    meta = json.loads((MODEL_DIR / "model.json").read_text())
    drop = set(args.drop_task)
    if drop:
        meta = {**meta, "dropped_tasks": sorted(drop),
                "tasks": {t: c for t, c in meta["tasks"].items() if t not in drop},
                "metrics": {k: v for k, v in (meta.get("metrics") or {}).items()
                            if not any(k == f"val_macro_f1_{t}" for t in drop)}}

    # DEST is served to the browser — this writes straight to production, with no
    # promotion step in between. A head at chance carries a real-looking
    # confidence in the UI, which is worse than the honest "estimate" it replaces.
    weak = near_chance_tasks(meta)
    if weak and not args.force:
        print(f"Blocked: {', '.join(weak)} scored at or near chance — exporting would "
              f"ship a coin flip to users as a confidence.\n"
              f"Metrics: {meta.get('metrics')}\n"
              f"Retrain with more data, or re-run with --force if you accept that.",
              file=sys.stderr)
        return 1

    net = MultiHeadNet(pretrained=False)
    net.load_state_dict(torch.load(MODEL_DIR / "current.pt", map_location="cpu", weights_only=True))
    net.eval()
    if meta.get("preprocess", {}).get("color_constancy"):
        net = ColorConstancyInGraph(net).eval()

    all_names = output_names()
    keep = [i for i, n in enumerate(all_names) if n.removeprefix("logits_") not in drop]
    if drop:
        net = KeepHeads(net, keep).eval()

    dest = args.dest
    dest.mkdir(parents=True, exist_ok=True)
    onnx_path = dest / "model.onnx"
    names = [all_names[i] for i in keep]
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
    (dest / "model.json").write_text(json.dumps(meta, indent=2))
    print(f"exported {meta['version']} → {onnx_path} "
          f"({onnx_path.stat().st_size // 1_000_000} MB), outputs: {names}")
    print("Browser picks it up at /models/face/model.onnx on next load.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
