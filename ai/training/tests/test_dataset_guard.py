import pytest
from ai.training.dataset_guard import check, scan, DatasetIntegrityError


def _img(dir_, name: str):
    dir_.mkdir(parents=True, exist_ok=True)
    p = dir_ / name
    p.write_bytes(b"\xff\xd8\xff\xe0jpeg")
    return p


def test_clean_dataset_passes(tmp_path):
    _img(tmp_path / "melanoma", "a.jpg")
    _img(tmp_path / "nevus", "b.jpg")
    r = check(tmp_path)
    assert r["files"] == 2 and r["evicted"] == [] and r["conflicts"] == []


def test_evicted_icloud_stub_fails(tmp_path):
    _img(tmp_path / "melanoma", "a.jpg")
    (tmp_path / "melanoma" / ".b.jpg.icloud").write_bytes(b"")
    with pytest.raises(DatasetIntegrityError, match="evicted"):
        check(tmp_path)


def test_conflicted_copy_fails_only_when_original_present(tmp_path):
    d = tmp_path / "nevus"
    _img(d, "img.jpg")
    _img(d, "img 2.jpg")  # iCloud conflicted copy beside the original
    with pytest.raises(DatasetIntegrityError, match="conflicted-copy"):
        check(tmp_path)


def test_lone_numbered_file_is_not_a_conflict(tmp_path):
    # "photo 2.jpg" with no "photo.jpg" is a legitimate name, not a conflict copy.
    _img(tmp_path / "nevus", "photo 2.jpg")
    assert scan(tmp_path)["conflicts"] == []


def test_min_files_floor(tmp_path):
    tmp_path.mkdir(exist_ok=True)
    with pytest.raises(DatasetIntegrityError, match="partial sync"):
        check(tmp_path, min_files=1)
