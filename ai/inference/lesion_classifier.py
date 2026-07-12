"""
ISIC2019 EfficientNet-B1 lesion classifier inference.

Input:
    cropped lesion image

Output:
    class probabilities
"""

from pathlib import Path
import json
import sys

import torch
import timm
from torchvision import transforms
from PIL import Image


MODEL_DIR = Path("ai/models/classifier/isic2019")

WEIGHTS = MODEL_DIR / "best_weights.pth"
INFO = MODEL_DIR / "model_info.json"


class LesionClassifier:

    def __init__(self):

        self.device = (
            "mps"
            if torch.backends.mps.is_available()
            else "cpu"
        )

        print(
            f"Loading lesion classifier on {self.device}"
        )


        with open(INFO) as f:
            self.info = json.load(f)


        self.classes = self.info["class_mapping"]


        self.idx_to_class = {
            int(v): k
            for k, v in self.classes.items()
        }


        self.model = self._load_model()


        self.transform = transforms.Compose(
            [
                transforms.Resize(
                    (240,240)
                ),

                transforms.ToTensor(),

                transforms.Normalize(
                    mean=[
                        0.485,
                        0.456,
                        0.406
                    ],

                    std=[
                        0.229,
                        0.224,
                        0.225
                    ]
                )
            ]
        )


    def _load_model(self):

        print(
            "Creating timm EfficientNet-B1..."
        )


        model = timm.create_model(
            "efficientnet_b1",
            pretrained=False,
            num_classes=len(self.classes)
        )


        # weights_only=True: refuse pickled code — a swapped/tampered .pth
        # must not be able to execute anything on load.
        checkpoint = torch.load(
            WEIGHTS,
            map_location="cpu",
            weights_only=True
        )


        # Handle checkpoints saved like:
        # {"model_state_dict": ...}

        if "model_state_dict" in checkpoint:

            checkpoint = checkpoint["model_state_dict"]


        # Handle DDP training checkpoints

        cleaned = {}

        for key, value in checkpoint.items():

            if key.startswith("module."):

                key = key.replace(
                    "module.",
                    ""
                )

            cleaned[key] = value


        model.load_state_dict(
            cleaned,
            strict=True
        )


        model.to(
            self.device
        )


        model.eval()


        print(
            "Lesion classifier loaded successfully"
        )


        return model



    @torch.no_grad()
    def predict(
        self,
        image_path
    ):

        image = Image.open(
            image_path
        ).convert(
            "RGB"
        )

        return self.predict_image(image)


    @torch.no_grad()
    def predict_image(
        self,
        image
    ):
        """Classify an already-loaded PIL image (used by the pipeline on YOLO crops)."""

        image = image.convert("RGB")


        tensor = self.transform(
            image
        )


        tensor = tensor.unsqueeze(
            0
        )


        tensor = tensor.to(
            self.device
        )


        output = self.model(
            tensor
        )


        probabilities = torch.softmax(
            output,
            dim=1
        )[0]


        result = {}


        for idx, prob in enumerate(probabilities):

            label = self.idx_to_class[idx]

            result[label] = float(
                prob.cpu()
            )


        return dict(
            sorted(
                result.items(),
                key=lambda x: x[1],
                reverse=True
            )
        )



if __name__ == "__main__":

    if len(sys.argv) < 2:

        print(
            "Usage: python lesion_classifier.py image.jpg"
        )

        sys.exit(1)


    classifier = LesionClassifier()


    prediction = classifier.predict(
        sys.argv[1]
    )


    print(
        json.dumps(
            prediction,
            indent=2
        )
    )