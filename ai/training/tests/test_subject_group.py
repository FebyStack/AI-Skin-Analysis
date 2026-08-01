from ai.training.dedup import subject_group


def test_roboflow_reencodes_of_one_photo_share_a_group():
    """killa92 ships the same photo in train/ and valid/ under different rf
    hashes. Grouping by file stem put both sides of one photo across the
    train/val split, which is why its reported F1 was optimistic."""
    a = "dry_2fd3aad955e9092d3960_jpg.rf.92d37117f5252580d3c6c6550012ddf5"
    b = "dry_new_2fd3aad955e9092d3960_jpg.rf.92068cc7fa9a18832cfee723df20131c"
    assert subject_group(a) == subject_group(b) == "2fd3aad955e9092d3960"


def test_the_32_hex_roboflow_hash_is_never_mistaken_for_a_source_id():
    """A 20-char window inside the rf hash must not match, or every file
    collapses into one group and training loses its split entirely."""
    assert subject_group("plain_jpg.rf.92068cc7fa9a18832cfee723df20131c") == (
        "plain_jpg.rf.92068cc7fa9a18832cfee723df20131c"
    )


def test_auto_link_names_group_by_subject_across_angles():
    assert subject_group("skindefects__acne-1__front") == "skindefects__acne-1"
    assert subject_group("skindefects__acne-1__left_side") == "skindefects__acne-1"


def test_unstructured_names_are_their_own_group():
    assert subject_group("levle0_100") == "levle0_100"
    uuid = "0bfc17ea-0b16-41ea-8bbd-2dc09dde8ae8"
    assert subject_group(uuid) == uuid
