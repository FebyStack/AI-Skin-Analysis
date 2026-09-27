"""Re-encode a dataset tree to one uniform resolution and JPEG quality.

Corpus fingerprint, measured 2026-09-21: clearskin is 100% 640x640, acne04 100%
1024x1024, acnegrading 98% 500x555, acne04full 85% 3112x3456. Since `clear` comes
only from clearskin, resolution correlates with class — and it survives
Resize(224,224) as a downscale-factor artefact (3112->224 smooths pores away;
640->224 keeps them). The model can read corpus off apparent sharpness.

Normalising every image to the same longest side and the same encoder removes that
cue. Aspect ratio is preserved: forcing square would crop different amounts of face
per corpus, trading one artefact for another.

Also cuts peak RAM — a 3112x3456 JPEG decodes to ~32MB, and a batch of 32 of those
is ~1GB before any of it is resized to 224.

    .venv/bin/python -m ai.training.normalize_corpus ai/datasets ai/datasets-512 acne skintype
"""
from __future__ import annotations

import sys
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

from PIL import Image

MAX_SIDE = 512
QUALITY = 92
EXTS = {".jpg", ".jpeg", ".png", ".webp", ".bmp"}


def _one(job: tuple[str, str]) -> bool:
    src, dst = Path(job[0]), Path(job[1])
    try:
        with Image.open(src) as im:
            im = im.convert("RGB")           # drops EXIF and alpha
            w, h = im.size
            if max(w, h) > MAX_SIDE:
                s = MAX_SIDE / max(w, h)
                im = im.resize((round(w * s), round(h * s)), Image.LANCZOS)
            dst.parent.mkdir(parents=True, exist_ok=True)
            im.save(dst, "JPEG", quality=QUALITY)   # one encoder for every corpus
        # A successful save is not a readable file: under disk pressure PIL can
        # return cleanly having written a truncated JPEG, and the corruption then
        # surfaces mid-training, hours later. Verify here, where it is cheap.
        with Image.open(dst) as check:
            check.verify()
        return True
    except Exception:
        dst.unlink(missing_ok=True)   # never leave a half-written file behind
        return False


def main(argv: list[str]) -> int:
    src_root, dst_root, *subdirs = argv
    jobs = []
    for sub in subdirs:
        for p in (Path(src_root) / sub).rglob("*"):
            if p.is_file() and p.suffix.lower() in EXTS and not p.name.startswith("."):
                rel = p.relative_to(src_root).with_suffix(".jpg")
                jobs.append((str(p.resolve()), str(Path(dst_root) / rel)))
    print(f"{len(jobs)} images -> {dst_root} (max side {MAX_SIDE}, q{QUALITY})")
    with ProcessPoolExecutor(max_workers=6) as ex:
        ok = sum(ex.map(_one, jobs, chunksize=32))
    print(f"done: {ok} written, {len(jobs) - ok} failed")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
