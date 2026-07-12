"""
Fetch the pretrained model weights this project uses. Weights are gitignored
(large binaries, provided out-of-band); this script re-downloads them onto a
fresh machine into the paths the code expects.

    .venv/bin/python -m ai.models.fetch_models            # fetch all
    .venv/bin/python -m ai.models.fetch_models classifier # one target

Targets: classifier · detector · segmentation · face-parsing
"""
from __future__ import annotations

import sys
import urllib.request
from pathlib import Path

BASE = Path(__file__).resolve().parent  # ai/models


def _download(url: str, dest: Path) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    if dest.exists():
        print(f"  ✓ exists: {dest.relative_to(BASE.parent.parent)}")
        return
    print(f"  ↓ {url}\n    → {dest.relative_to(BASE.parent.parent)}")
    urllib.request.urlretrieve(url, dest)
    print(f"  ✓ {dest.stat().st_size // 1_000_000} MB")


def fetch_classifier() -> None:
    # PAD-UFES/ISIC-2019 6-class EfficientNet-B1 (timm). Source: Hugging Face.
    from huggingface_hub import hf_hub_download

    repo = "conan17970/efficientnet-b1-skin-cancer-isic2019"
    dest_dir = BASE / "classifier" / "isic2019"
    dest_dir.mkdir(parents=True, exist_ok=True)
    for filename in ("best_weights.pth", "model_info.json"):
        target = dest_dir / filename
        if target.exists():
            print(f"  ✓ exists: {target.relative_to(BASE.parent.parent)}")
            continue
        cached = hf_hub_download(repo_id=repo, filename=filename)
        target.write_bytes(Path(cached).read_bytes())
        print(f"  ✓ {filename}")


def fetch_detector() -> None:
    # Generic YOLO11-nano (COCO). NOT lesion-trained — placeholder detector.
    _download(
        "https://github.com/ultralytics/assets/releases/download/v8.3.0/yolo11n.pt",
        BASE / "detector" / "yolo11n.pt",
    )


def fetch_segmentation() -> None:
    # MobileSAM lightweight segmentation weights.
    _download(
        "https://github.com/ChaoningZhang/MobileSAM/raw/master/weights/mobile_sam.pt",
        BASE / "segmentation" / "mobile_sam.pt",
    )


def fetch_face_parsing() -> None:
    # SegFormer-B5 face parsing (CelebAMask-HQ). Non-commercial license — see HF model card.
    from huggingface_hub import hf_hub_download

    repo = "jonathandinu/face-parsing"
    dest_dir = BASE.parent.parent / "frontend" / "public" / "models" / "face-parsing"
    dest_dir.mkdir(parents=True, exist_ok=True)
    target = dest_dir / "model_quantized.onnx"
    if target.exists():
        print(f"  ✓ exists: {target.relative_to(BASE.parent.parent)}")
        return
    cached = hf_hub_download(repo_id=repo, filename="onnx/model_quantized.onnx")
    target.write_bytes(Path(cached).read_bytes())
    print(f"  ✓ {target.stat().st_size // 1_000_000} MB → {target.relative_to(BASE.parent.parent)}")


TARGETS = {
    "classifier": fetch_classifier,
    "detector": fetch_detector,
    "segmentation": fetch_segmentation,
    "face-parsing": fetch_face_parsing,
}


def main(argv: list[str]) -> int:
    names = argv or list(TARGETS)
    unknown = [n for n in names if n not in TARGETS]
    if unknown:
        print(f"unknown target(s): {unknown}. choose from {list(TARGETS)}")
        return 1
    for name in names:
        print(f"[{name}]")
        TARGETS[name]()
    print("done.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
