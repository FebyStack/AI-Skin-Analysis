"""SINGLE source of preprocessing. Training and serving both import from here —
never duplicate these transforms (train/serve skew is the failure mode this kills)."""
import albumentations as A
from albumentations.pytorch import ToTensorV2

IMG_SIZE = 224
NORM = dict(mean=(0.485, 0.456, 0.406), std=(0.229, 0.224, 0.225))

def serve_transforms() -> A.Compose:
    return A.Compose([
        A.Resize(IMG_SIZE, IMG_SIZE),
        A.Normalize(**NORM),
        ToTensorV2(),
    ])

def train_transforms() -> A.Compose:
    return A.Compose([
        A.RandomResizedCrop(size=(IMG_SIZE, IMG_SIZE), scale=(0.7, 1.0)),
        A.HorizontalFlip(p=0.5),
        A.VerticalFlip(p=0.5),
        A.ColorJitter(brightness=0.2, contrast=0.2, saturation=0.1, hue=0.02, p=0.5),
        A.Normalize(**NORM),
        ToTensorV2(),
    ])
