"""Map each source's label vocabulary to the 8 canonical ISIC-2019 classes; keep in sync with the future lesion-module contract when it lands."""
CANONICAL = [
    "Melanoma", "Nevus", "Basal Cell Carcinoma", "Actinic Keratosis",
    "Benign Keratosis", "Dermatofibroma", "Vascular Lesion", "Squamous Cell Carcinoma",
]

_ALIASES = {
    "mel": "Melanoma", "melanoma": "Melanoma",
    "nv": "Nevus", "nevus": "Nevus", "nevi": "Nevus",
    "bcc": "Basal Cell Carcinoma", "basal cell carcinoma": "Basal Cell Carcinoma",
    "akiec": "Actinic Keratosis", "ak": "Actinic Keratosis", "actinic keratosis": "Actinic Keratosis",
    "bkl": "Benign Keratosis", "benign keratosis": "Benign Keratosis", "seborrheic keratosis": "Benign Keratosis",
    "df": "Dermatofibroma", "dermatofibroma": "Dermatofibroma",
    "vasc": "Vascular Lesion", "vascular lesion": "Vascular Lesion",
    "scc": "Squamous Cell Carcinoma", "squamous cell carcinoma": "Squamous Cell Carcinoma",
}

def normalize_label(raw: str) -> str | None:
    return _ALIASES.get(raw.strip().lower())
