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
        # Phone/iPad camera simulation: the app's real inputs are handheld webcam
        # frames re-encoded to JPEG, not clean dataset photos. Teach the model that
        # distribution — compression artifacts, sensor noise, slight motion blur,
        # exposure swings — so scans from phone/tablet cameras score reliably.
        A.ImageCompression(quality_range=(35, 90), p=0.5),
        A.GaussNoise(std_range=(0.02, 0.08), p=0.3),
        A.MotionBlur(blur_limit=(3, 7), p=0.2),
        A.RandomBrightnessContrast(brightness_limit=0.25, contrast_limit=0.25, p=0.5),
        A.Normalize(**NORM),
        ToTensorV2(),
    ])
