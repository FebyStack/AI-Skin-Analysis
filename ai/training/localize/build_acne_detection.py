"""Assemble the one-class acne-lesion detection dataset (YOLO format) from public sources.

    .venv.nosync/bin/python -m ai.training.localize.build_acne_detection RAW [RAW ...] OUT

Sources are Roboflow YOLO exports: any `<split>/images` dir with a sibling `labels` dir.
- Every lesion subclass becomes class 0 "acne"; polygon labels become their bounding box.
- Roboflow copies of one photo share a source stem and stay on one side of the split —
  `subject_group` does not group `levle0_163_jpg.rf.<hash>` names, so `source_stem` does.
- Photos in the classification frozen exam (by stem or group) are excluded.
- Shades-of-Grey is applied here, so training sees what the browser feeds the detector.
- The test split is recorded by hash (split_manifest.json), like build_master's frozen test set.
"""
from __future__ import annotations

import hashlib
import json
import re
import sys
from pathlib import Path

import numpy as np
from PIL import Image

from ai.training.transforms import shades_of_gray

FROZEN = Path("ai/training/multi/frozen_test.json")
EXTS = {".jpg", ".jpeg", ".png"}
_ROBOFLOW = re.compile(r"_(jpg|jpeg|png)\.rf\.[0-9a-f]+$", re.I)


def source_stem(stem: str) -> str:
    """'levle0_163_jpg.rf.ab12' -> 'levle0_163': every Roboflow copy of one photo maps here."""
    return _ROBOFLOW.sub("", stem)


def merge_label_lines(text: str) -> list[str]:
    """YOLO lines of any class (box or polygon) -> '0 cx cy w h' lines."""
    out = []
    for line in text.splitlines():
        v = line.split()
        if len(v) < 5:
            continue
        nums = [float(n) for n in v[1:]]
        if len(nums) == 4:
            cx, cy, w, h = nums
        else:
            xs, ys = nums[0::2], nums[1::2]
            cx, cy = (min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2
            w, h = max(xs) - min(xs), max(ys) - min(ys)
        if w > 0 and h > 0:
            out.append(f"0 {cx:.6f} {cy:.6f} {w:.6f} {h:.6f}")
    return out


def split_of(group: str) -> str:
    """Deterministic, group-level 70/15/15 split."""
    bucket = int(hashlib.sha256(group.encode()).hexdigest(), 16) % 100
    return "train" if bucket < 70 else "val" if bucket < 85 else "test"


def frozen_exclusions(path: Path | None = None) -> set[str]:
    """Stems and groups of the classification frozen exam."""
    path = path or FROZEN
    if not path.exists():
        return set()
    frozen = json.loads(path.read_text())
    return {Path(p).name for p in frozen["paths"]} | set(frozen.get("groups", []))


def collect(raw: Path, excluded: set[str]) -> list[tuple[Path, list[str], str]]:
    """(image, merged label lines, group) for every labelled image under `raw`."""
    rows = []
    for images in sorted(raw.rglob("images")):
        labels = images.parent / "labels"
        if not labels.is_dir():
            continue
        for img in sorted(images.iterdir()):
            if img.suffix.lower() not in EXTS or img.name.startswith("."):
                continue
            label = labels / f"{img.stem}.txt"
            group = source_stem(img.stem)
            if not label.exists() or group in excluded:
                continue
            rows.append((img, merge_label_lines(label.read_text()), group))
    return rows


def split_manifest(out: Path) -> dict:
    names = sorted(p.name for p in (out / "images" / "test").glob("*.jpg"))
    return {"sha256": hashlib.sha256("\n".join(names).encode()).hexdigest(), "images": names}


def main(argv: list[str]) -> int:
    *raws, out = [Path(a) for a in argv]
    if out.exists() and any(out.iterdir()):
        print(f"refusing to write into non-empty OUT: {out}", file=sys.stderr)
        return 1
    excluded = frozen_exclusions()
    counts = {"train": 0, "val": 0, "test": 0}
    for k, raw in enumerate(raws):
        for img, lines, group in collect(raw, excluded):
            split = split_of(group)
            name = f"{k}_{img.stem}"  # sources may reuse stems
            dst = out / "images" / split / f"{name}.jpg"
            dst.parent.mkdir(parents=True, exist_ok=True)
            rgb = np.asarray(Image.open(img).convert("RGB"))
            Image.fromarray(shades_of_gray(rgb)).save(dst, "JPEG", quality=95)
            lab = out / "labels" / split / f"{name}.txt"
            lab.parent.mkdir(parents=True, exist_ok=True)
            lab.write_text("\n".join(lines) + ("\n" if lines else ""))  # empty = no lesions (a true negative)
            counts[split] += 1
    (out / "data.yaml").write_text(
        f"path: {out.resolve()}\ntrain: images/train\nval: images/val\ntest: images/test\nnames:\n  0: acne\n")
    manifest = split_manifest(out)
    (out / "split_manifest.json").write_text(json.dumps(manifest, indent=1))
    print(f"{sum(counts.values())} images -> {out}  {counts}  test sha256={manifest['sha256'][:12]}  "
          f"(frozen-exam exclusions: {len(excluded)})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
