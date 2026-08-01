"""Near-duplicate frames must not straddle the train/val split.

Clinic scans are named with a bare UUID, so `subject_group` returns the UUID
itself and every scan becomes its own group. Two captures of the same person
seconds apart then land on opposite sides of StratifiedGroupKFold and validation
scores itself on what it trained on — the failure that destroyed four models
here (0.96-1.00 accuracy, deleted 2026-07-27).

Grouping by perceptual hash keeps both images and forces them to the same side,
which is why this is a grouping and not a de-duplication.
"""
from pathlib import Path

from PIL import Image, ImageEnhance

from ai.training.dedup import phash_group_map


def _face(path: Path, seed: int) -> None:
    """A deterministic non-uniform image; phash on a flat colour is degenerate."""
    im = Image.new("RGB", (128, 128))
    px = im.load()
    for y in range(128):
        for x in range(128):
            px[x, y] = ((x * 3 + seed * 47) % 256, (y * 5 + seed * 13) % 256, (x * y + seed) % 256)
    im.save(path)


def test_near_duplicates_share_a_group(tmp_path: Path) -> None:
    a = tmp_path / "0bfc17ea-0b16-41ea-8bbd-2dc09dde8ae8.jpg"
    b = tmp_path / "7c2d90ff-1a55-4bb1-9d02-5f1c8e6a2b41.jpg"
    _face(a, 1)
    # Same photograph, marginally brighter — a second capture in the same session.
    Image.open(a).point(lambda v: min(255, int(v * 1.06))).save(b)

    groups = phash_group_map([a, b])

    assert groups[str(a)] == groups[str(b)]


def test_distinct_faces_keep_distinct_groups(tmp_path: Path) -> None:
    a = tmp_path / "aaaaaaaa-0b16-41ea-8bbd-2dc09dde8ae8.jpg"
    b = tmp_path / "bbbbbbbb-1a55-4bb1-9d02-5f1c8e6a2b41.jpg"
    _face(a, 1)
    _face(b, 9)

    groups = phash_group_map([a, b])

    # Collapsing unrelated subjects would shrink the effective dataset and make
    # the split refuse to stratify.
    assert groups[str(a)] != groups[str(b)]


def test_group_id_is_stable_regardless_of_input_order(tmp_path: Path) -> None:
    a = tmp_path / "aaaaaaaa-0b16-41ea-8bbd-2dc09dde8ae8.jpg"
    b = tmp_path / "bbbbbbbb-1a55-4bb1-9d02-5f1c8e6a2b41.jpg"
    _face(a, 1)
    Image.open(a).point(lambda v: min(255, int(v * 1.06))).save(b)

    # An unstable id would reshuffle the split between runs and silently break
    # the manifest-hash reproducibility guard in build_master.
    assert phash_group_map([a, b]) == phash_group_map([b, a])
