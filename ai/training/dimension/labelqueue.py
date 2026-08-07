"""Resumable work queue for annotating the unlabelled face corpus.

Build once (`python -m ai.training.dimension.labelqueue build`), then each
session asks for `next` and labels that batch. Resume state is derived, not
stored: an image is done when it appears in any `_labels/batch-*.jsonl`, so a
crashed or half-finished batch simply reappears.

Sources are interleaved round-robin, which is the point rather than a detail.
Any PREFIX of the manifest then holds roughly the whole corpus's source mix, so
however far the run gets, no dimension ends up with its `present` class from one
corpus and its `absent` from another — the exact failure that scored four models
0.96-1.00 and got them deleted on 2026-07-27.
"""
from __future__ import annotations

import json
import random
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from ai.training.dedup import phash_hex
from ai.training.paths import datasets_dir

IMG_EXTS = {".jpg", ".jpeg", ".png", ".webp"}
BATCH_SIZE = 25

# Face corpora only. raw/ham10000, raw/isic2019 and raw/padufes20 are dermoscopic
# and clinical LESION images — the facial-zone rubric does not apply to them.
SOURCES: dict[str, str] = {
    "killa92": "raw/killa92",
    "multi": "raw/_multi",
    "acne04full": "raw/acne04full",
    "acnegrading": "raw/acnegrading",
    "acne04": "raw/acne04",
    "skindefects": "_incoming/skin-defects",
    "botox": "_incoming/botox",
}

# Sources shooting several angles of one subject. The subject key has to span
# those angles or the same face lands on both sides of the train/val split.
MULTI_ANGLE = {"skindefects"}


def subject_of(source: str, rel: Path) -> str:
    if source in MULTI_ANGLE:
        return f"{rel.parent.parent.name}-{rel.parent.name}"
    return rel.stem


def shuffle_within_source(by_source: dict[str, list[dict]], seed: int = 0) -> dict[str, list[dict]]:
    """Break up each source's per-class directory blocks.

    Sources store one class per directory and `scan()` walks them in path order,
    so a source emits all of one class before any of the next. killa92's `oily`
    faces sat past batch 62 and `dry` past batch 8 — but the 40/class bar is
    reached long before that, so the model would have hit "ready" having never
    seen an oily face. Interleaving sources is not enough; the classes inside a
    source have to be mixed too.

    Seeded so the manifest is reproducible: rebuilding it must not renumber work
    that is already done.
    """
    out = {}
    for source, rows in by_source.items():
        shuffled = list(rows)
        random.Random(f"{seed}:{source}").shuffle(shuffled)
        out[source] = shuffled
    return out


def interleave(by_source: dict[str, list[dict]]) -> list[dict]:
    """Round-robin, longest source first so the mix stays even as short ones end."""
    order = sorted(by_source, key=lambda s: -len(by_source[s]))
    out: list[dict] = []
    for i in range(max((len(v) for v in by_source.values()), default=0)):
        out += [by_source[s][i] for s in order if i < len(by_source[s])]
    return out


def keep_subjects_together(rows: list[dict]) -> list[dict]:
    """Pull a subject's other angles up next to its first.

    skin-defects and botox ship several angles per subject, and the
    shadow-vs-pigment discriminator wants to compare them. Shuffling by IMAGE
    scattered 53 of 54 multi-image subjects across different batches, so no
    annotator ever saw two angles of one face — the multi-angle test could never
    fire on the only corpus that supports it.

    Order is by each subject's FIRST appearance, so the source interleave and the
    within-source shuffle both survive; only the 54 subjects with extra angles
    move at all.
    """
    groups: dict[tuple, list[dict]] = {}
    for r in rows:
        groups.setdefault((r.get("source"), r.get("subject", r["image"])), []).append(r)
    return [r for g in groups.values() for r in g]  # dict preserves first-seen order


def assign_batches(rows: list[dict]) -> list[dict]:
    """Pack into batches, rolling over only at a subject boundary.

    A batch may run a couple over BATCH_SIZE rather than cut a subject in half —
    splitting one is the bug this exists to prevent.
    """
    batch = filled = 0
    prev = None
    for r in rows:
        key = (r.get("source"), r.get("subject", r["image"]))
        if filled >= BATCH_SIZE and key != prev:
            batch += 1
            filled = 0
        r["batch"] = batch
        filled += 1
        prev = key
    return rows


def scan() -> dict[str, list[dict]]:
    base = datasets_dir()
    found: dict[str, list[dict]] = {}
    for source, rel_root in SOURCES.items():
        root = base / rel_root
        if not root.exists():
            continue
        rows = []
        for p in sorted(root.rglob("*")):
            if p.is_file() and p.suffix.lower() in IMG_EXTS:
                rel = p.relative_to(root)
                rows.append(
                    {
                        "image": str(p.relative_to(base)),
                        "source": source,
                        "subject": subject_of(source, rel),
                    }
                )
        if rows:
            found[source] = rows
    return found


def drop_duplicates(rows: list[dict]) -> list[dict]:
    """Exact perceptual-hash collisions only.

    `ai.training.dedup.find_duplicates` compares every pair within a Hamming
    radius, which is O(n^2) and hopeless at 11k images. An exact 64-bit phash
    match still catches re-encodes and the cross-corpus reuse actually on disk
    (acne04 inside acne04full, shared images between killa92 and _multi).
    """
    base = datasets_dir()
    with ThreadPoolExecutor() as pool:
        hashes = list(pool.map(lambda r: _safe_hash(base / r["image"]), rows))
    seen: set[str] = set()
    out = []
    for row, h in zip(rows, hashes):
        if h is None or h in seen:
            continue
        seen.add(h)
        out.append(row)
    return out


def _safe_hash(path: Path) -> str | None:
    try:
        return phash_hex(path)
    except Exception:
        return None  # unreadable/corrupt — nothing to label


def labels_dir() -> Path:
    return datasets_dir() / "_labels"


def manifest_path() -> Path:
    return labels_dir() / "manifest.jsonl"


def read_manifest() -> list[dict]:
    p = manifest_path()
    if not p.exists():
        return []
    return [json.loads(l) for l in p.read_text().splitlines() if l.strip()]


def labelled() -> set[str]:
    """Every image already carrying a record, across all batch files."""
    done: set[str] = set()
    for f in sorted(labels_dir().glob("batch-*.jsonl")):
        for line in f.read_text().splitlines():
            if line.strip():
                done.add(json.loads(line)["image"])
    return done


def work_units(rows: list[dict], done: set[str]) -> list[list[dict]]:
    """Repack the unlabelled remainder into full annotator-sized units.

    Batch numbers order the corpus; they are not work assignments. After a
    manifest rebuild the already-done images scatter, leaving batches holding a
    handful of unlabelled each — and an annotator dispatched for 2 images pays
    its whole startup for 2 images.

    Manifest order is preserved (so the source interleave still holds for any
    prefix) and subjects are never cut across units.
    """
    units: list[list[dict]] = []
    unit: list[dict] = []
    prev = None
    for r in rows:
        if r["image"] in done:
            continue
        key = (r.get("source"), r.get("subject", r["image"]))
        if len(unit) >= BATCH_SIZE and key != prev:
            units.append(unit)
            unit = []
        unit.append(r)
        prev = key
    if unit:
        units.append(unit)
    return units


def next_batch() -> tuple[int | None, list[dict]]:
    """Lowest-numbered batch with unlabelled images, and those images."""
    pending = [r for r in read_manifest() if r["image"] not in labelled()]
    if not pending:
        return None, []
    n = min(r["batch"] for r in pending)
    return n, [r for r in pending if r["batch"] == n]


def build() -> list[dict]:
    rows = assign_batches(keep_subjects_together(drop_duplicates(interleave(shuffle_within_source(scan())))))
    labels_dir().mkdir(parents=True, exist_ok=True)
    manifest_path().write_text("".join(json.dumps(r) + "\n" for r in rows))
    return rows


def _status() -> None:
    rows, done = read_manifest(), labelled()
    by_source: dict[str, int] = {}
    for r in rows:
        by_source[r["source"]] = by_source.get(r["source"], 0) + 1
    print(f"manifest {len(rows)}  labelled {len(done)}  remaining {len(rows) - len(done)}")
    print(f"batches  {(len(rows) + BATCH_SIZE - 1) // BATCH_SIZE}  of {BATCH_SIZE}")
    print(f"sources  {by_source}")


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "status"
    if cmd == "build":
        rows = build()
        print(f"manifest: {len(rows)} images -> {manifest_path()}")
    elif cmd == "next":
        count = int(sys.argv[2]) if len(sys.argv) > 2 else 1
        n, _ = next_batch()
        for b in range(n or 0, (n or 0) + count):
            rows = [r for r in read_manifest() if r["batch"] == b and r["image"] not in labelled()]
            if rows:
                print(f"# batch {b:03d}")
                print("\n".join(r["image"] for r in rows))
    else:
        _status()
