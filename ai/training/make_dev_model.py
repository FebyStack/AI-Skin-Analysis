"""Create an UNTRAINED EfficientNet-B0 so the service runs before Plan 8 trains a real one.
Predictions are meaningless — version string makes that loud."""
import json
from pathlib import Path
import torch
from torchvision.models import efficientnet_b0

CLASSES = [
    "Melanoma", "Nevus", "Basal Cell Carcinoma", "Actinic Keratosis",
    "Benign Keratosis", "Dermatofibroma", "Vascular Lesion", "Squamous Cell Carcinoma",
]

def main(out_dir: Path = Path("ai/models/production")) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    net = efficientnet_b0(num_classes=len(CLASSES))
    torch.save(net.state_dict(), out_dir / "current.pt")
    (out_dir / "model.json").write_text(json.dumps({
        "name": "efficientnet-b0",
        "version": "0.0.0-dev-untrained",
        "classes": CLASSES,
        "img_size": 224,
        "metrics": None,
        "dataset_manifest_sha256": None,
    }, indent=2))
    print(f"dev model written to {out_dir}")

if __name__ == "__main__":
    main()
