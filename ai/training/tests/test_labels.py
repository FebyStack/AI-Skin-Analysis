from ai.training.ingest.labels import normalize_label, CANONICAL

def test_maps_source_labels_to_canonical():
    assert normalize_label("mel") == "Melanoma"
    assert normalize_label("MEL") == "Melanoma"
    assert normalize_label("nv") == "Nevus"
    assert normalize_label("bcc") == "Basal Cell Carcinoma"
    assert normalize_label("akiec") == "Actinic Keratosis"

def test_unknown_label_returns_none():
    assert normalize_label("not-a-class") is None

def test_canonical_is_the_eight_isic_classes():
    assert len(CANONICAL) == 8 and "Melanoma" in CANONICAL
