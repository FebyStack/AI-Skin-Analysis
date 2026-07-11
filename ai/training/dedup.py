# ai/training/dedup.py
"""Never train on duplicates. Primary: perceptual hash (near-dup). Secondary: source_id match."""
from pathlib import Path
import imagehash
from PIL import Image

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
        h = imagehash.hex_to_hash(phash_hex(row["path"]))
        if sid and sid in seen_ids:
            dropped.append({**row, "reason": "source_id"}); continue
        if any((h - k) <= hamming_max for k in kept_hashes):
            dropped.append({**row, "reason": "phash"}); continue
        keep.append(row); kept_hashes.append(h)
        if sid: seen_ids.add(sid)
    return keep, dropped
