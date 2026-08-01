# ai/training/dedup.py
"""Never train on duplicates. Primary: perceptual hash (near-dup). Secondary: source_id match."""
import re
from collections.abc import Iterable
from functools import lru_cache
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

@lru_cache(maxsize=None)
def phash_hex(path: str | Path) -> str:
    # Cached because the dimension ingest runs once per dimension (12 of them)
    # over the same scan images; decoding each JPEG 12 times is pure waste. Safe
    # for a single run — the dataset is not rewritten mid-process.
    with Image.open(path) as im:
        return str(imagehash.phash(im.convert("RGB")))

def phash_group_map(paths: Iterable[str | Path], hamming_max: int = 10) -> dict[str, str]:
    """Map each path to a group id shared with its near-duplicates.

    `subject_group` reads the subject out of the FILENAME, which works for the
    external corpora but not for clinic scans: those are named with a bare UUID,
    so every scan becomes its own group and two captures of one person seconds
    apart land on opposite sides of StratifiedGroupKFold.

    This groups rather than drops. Both frames stay in the dataset; they are
    merely forced to the same side of the split, so nothing is thrown away.

    `hamming_max` is looser than `find_duplicates`' 4 on purpose — that threshold
    asks "is this the same file?", this one asks "is this the same moment?".

    The id is the smallest stem in the cluster, so it does not depend on input
    order: an unstable id would reshuffle the split between runs and break the
    manifest-hash reproducibility guard in `build_master`.
    """
    items = [(str(p), imagehash.hex_to_hash(phash_hex(p))) for p in paths]
    parent: dict[str, str] = {p: p for p, _ in items}

    def find(x: str) -> str:
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    for i, (pi, hi) in enumerate(items):
        for pj, hj in items[i + 1 :]:
            if (hi - hj) <= hamming_max:
                ri, rj = find(pi), find(pj)
                if ri != rj:
                    parent[ri] = rj

    clusters: dict[str, list[str]] = {}
    for p, _ in items:
        clusters.setdefault(find(p), []).append(p)
    return {p: min(Path(q).stem for q in members) for members in clusters.values() for p in members}


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
