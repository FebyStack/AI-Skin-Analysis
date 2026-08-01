# ai/training/dedup.py
"""Never train on duplicates. Primary: perceptual hash (near-dup). Secondary: source_id match."""
import re
from pathlib import Path
import imagehash
from PIL import Image

# Roboflow exports keep a 20-hex id of the ORIGINAL photo, then append their own
# 32-hex re-encode hash: `dry_<id>_jpg.rf.<rfhash>`. The lookarounds stop a
# 20-char window inside that 32-hex hash from matching, which would otherwise
# collapse unrelated files into one group.
_SOURCE_ID = re.compile(r"(?<![0-9a-f])([0-9a-f]{20})(?![0-9a-f])")


def subject_group(stem: str) -> str:
    """Which underlying photograph a file belongs to, for the train/val split.

    killa92 ships the same source photo across train/, valid/ AND test/ under
    different Roboflow hashes — 4093 rows come from only 1620 distinct photos.
    Grouping by file stem gave each copy its own group, so StratifiedGroupKFold
    happily put one photo on both sides of the split and validation scored
    itself on images it had trained on.

    Auto-labelled links are named `<source>__<subject>[__<angle>]`, so their
    first two fields identify the person across several angles.
    """
    m = _SOURCE_ID.search(stem)
    if m:
        return m.group(1)
    parts = stem.split("__")
    return "__".join(parts[:2]) if len(parts) > 2 else stem

def phash_hex(path: str | Path) -> str:
    with Image.open(path) as im:
        return str(imagehash.phash(im.convert("RGB")))

def find_duplicates(rows: list[dict], hamming_max: int = 4) -> tuple[list[dict], list[dict]]:
    """rows: [{path, source_id, ...}]. Returns (keep, dropped). First occurrence wins."""
    keep: list[dict] = []
    kept_hashes: list[imagehash.ImageHash] = []
    seen_ids: set[str] = set()
    dropped: list[dict] = []
    for row in rows:
        sid = row.get("source_id")
        sid = sid.strip() if isinstance(sid, str) and sid.strip() else None  # pandas NaN etc. → no id
        h = imagehash.hex_to_hash(phash_hex(row["path"]))
        if sid and sid in seen_ids:
            dropped.append({**row, "reason": "source_id"}); continue
        if any((h - k) <= hamming_max for k in kept_hashes):
            dropped.append({**row, "reason": "phash"}); continue
        keep.append(row); kept_hashes.append(h)
        if sid: seen_ids.add(sid)
    return keep, dropped
