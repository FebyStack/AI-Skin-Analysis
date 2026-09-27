"""Add public Kaggle datasets to the face-model corpus, skipping anything we already have.

Sources (downloaded to $RAW, each with a LICENSE_NOTE.txt):
  ACNE04 full  -> acne/acne04v2/<label>/      labels from the levleN_ filename
  manithj      -> skintype/manithj/<label>/   Normal / Oily / Dry folders

An image is skipped if its source photo is already in the reference corpus (which contains
the frozen exam): same subject_group (ACNE04 filenames, Roboflow source hashes) or a
perceptual hash within DUP_DISTANCE. Both checks are needed — on 2026-09-21 pHash alone
missed 330 resized ACNE04 copies and 2,131 re-augmented killa92 photos in manithj.

    .venv/bin/python -m ai.training.multi.ingest_public RAW REFERENCE_CORPUS DEST
"""
from __future__ import annotations

import shutil
import sys
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

import imagehash
from PIL import Image

from ai.training.acne.fetch_acne04_full import LEVEL_RE, LEVEL_TO_LABEL
from ai.training.dedup import subject_group

DUP_DISTANCE = 6
EXTS = {".jpg", ".jpeg", ".png", ".webp"}


def _images(d: Path):
    return [p for p in d.rglob("*") if p.suffix.lower() in EXTS and not p.name.startswith(".")]


def _hash(p) -> imagehash.ImageHash | None:
    try:
        with Image.open(p) as im:
            return imagehash.phash(im.convert("RGB"))
    except Exception:
        return None


def _candidates(raw: Path) -> list[tuple[Path, str, str, str]]:
    """(src, task, source, label) for every usable image."""
    out = []
    for p in _images(raw / "kaggle_lexuanhieu131297_acne-severity-classification"):
        m = LEVEL_RE.search(p.name)
        if m and m.group(1) in LEVEL_TO_LABEL:
            out.append((p, "acne", "acne04v2", LEVEL_TO_LABEL[m.group(1)]))
    for p in _images(raw / "kaggle_manithj_oily-and-dry-skin-dataset"):
        label = p.parent.name.lower()
        if label in {"normal", "oily", "dry"}:
            out.append((p, "skintype", "manithj", label))
    return out


def main(argv: list[str]) -> int:
    raw, ref, dest = map(Path, argv)
    ref_imgs = _images(ref / "acne") + _images(ref / "skintype")
    cands = _candidates(raw)
    with ProcessPoolExecutor(max_workers=6) as ex:
        seen = [h for h in ex.map(_hash, ref_imgs, chunksize=64) if h is not None]
        new_hashes = list(ex.map(_hash, [c[0] for c in cands], chunksize=16))
    known = {subject_group(p.stem) for p in ref_imgs}
    print(f"reference: {len(seen)} images   candidates: {len(cands)}")
    added: dict[str, int] = {}; dup = bad = 0
    for (src, task, source, label), h in zip(cands, new_hashes):
        if h is None:
            bad += 1; continue
        if subject_group(src.stem) in known:
            dup += 1; continue
        if any(h - s <= DUP_DISTANCE for s in seen):
            dup += 1; continue
        seen.append(h)
        out = dest / task / source / label / src.name
        out.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(src, out)
        key = f"{task}/{source}/{label}"; added[key] = added.get(key, 0) + 1
    for k in sorted(added):
        print(f"  + {added[k]:5}  {k}")
    print(f"added {sum(added.values())}, skipped {dup} duplicates, {bad} unreadable")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
