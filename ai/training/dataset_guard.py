"""Fail loudly when the dataset under DATASETS_DIR was corrupted by an iCloud round-trip.

Two silent failure modes this catches BEFORE a training run wastes hours:
  1. Evicted files — iCloud "Optimize Mac Storage" replaces contents with 0-byte
     placeholder stubs (`.name.ext.icloud`). A `*.jpg` glob misses them, so you'd
     silently train on a SUBSET; opening one offline just fails.
  2. Conflicted-copy duplicates — two machines touch the folder and iCloud writes
     `name 2.jpg` beside `name.jpg`. A glob INCLUDES both, inflating/leaking the set.

Cheap filesystem scan. Call `preflight(subdir)` at the top of a training entrypoint,
or run standalone:  .venv/bin/python -m ai.training.dataset_guard [subdir]
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

from ai.training.paths import datasets_dir

# iCloud conflicted copies are "<stem> <n>" (files keep the extension: "img 2.jpg";
# dirs don't: "acne 2"). Only a conflict if the un-suffixed original also exists.
_CONFLICT_STEM = re.compile(r"^(.*) \d+$")


class DatasetIntegrityError(RuntimeError):
    pass


def _conflict_original(p: Path) -> Path | None:
    stem = p.stem if p.is_file() else p.name
    suffix = p.suffix if p.is_file() else ""
    m = _CONFLICT_STEM.match(stem)
    if not m:
        return None
    return p.with_name(m.group(1) + suffix)


def scan(root: Path) -> dict:
    """Walk `root` once. Returns {root, files, evicted, conflicts} (lists of paths as str)."""
    evicted: list[str] = []
    conflicts: list[str] = []
    files = 0
    for p in root.rglob("*"):
        if p.name == ".DS_Store":
            continue
        if p.is_file():
            if p.name.endswith(".icloud"):
                evicted.append(str(p))
                continue
            files += 1
        original = _conflict_original(p)
        if original is not None and original.exists():
            conflicts.append(str(p))
    return {"root": str(root), "files": files, "evicted": evicted, "conflicts": conflicts}


def check(root: Path, *, min_files: int = 0) -> dict:
    """Scan and raise DatasetIntegrityError on any integrity problem. Returns the scan dict on success."""
    if not root.exists():
        raise DatasetIntegrityError(f"dataset path does not exist: {root}")
    r = scan(root)
    problems: list[str] = []
    if r["evicted"]:
        problems.append(
            f"{len(r['evicted'])} iCloud-evicted placeholder(s) (*.icloud) — file contents are NOT "
            f"on disk. In Finder: select the folder → Download Now, or turn off 'Optimize Mac "
            f"Storage'. First: {r['evicted'][0]}"
        )
    if r["conflicts"]:
        problems.append(
            f"{len(r['conflicts'])} iCloud conflicted-copy duplicate(s) (e.g. 'name 2.jpg' beside "
            f"'name.jpg') — these inflate and leak the dataset. Remove them. First: {r['conflicts'][0]}"
        )
    if r["files"] < min_files:
        problems.append(f"only {r['files']} file(s) under {root} (expected ≥ {min_files}) — partial sync?")
    if problems:
        raise DatasetIntegrityError(
            "Dataset integrity check failed (likely an iCloud round-trip):\n  - "
            + "\n  - ".join(problems)
        )
    return r


def preflight(subdir: str | None = None, *, min_files: int = 0) -> dict:
    """Guard the dataset dir (optionally a subdir like 'acne'). Prints an OK line, raises on failure."""
    root = datasets_dir() if subdir is None else datasets_dir() / subdir
    r = check(root, min_files=min_files)
    print(f"dataset-guard OK: {r['files']} files under {root}, no iCloud eviction or conflict copies.")
    return r


def main(argv: list[str] | None = None) -> int:
    argv = sys.argv[1:] if argv is None else argv
    subdir = argv[0] if argv else None
    try:
        preflight(subdir)
    except DatasetIntegrityError as e:
        print(f"dataset-guard FAILED:\n{e}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
