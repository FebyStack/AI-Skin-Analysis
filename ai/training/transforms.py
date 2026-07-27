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

def train_transforms(face: bool = False) -> A.Compose:
    """Training augmentation. `face=True` for the face models (acne, skin type);
    the default suits lesion images.

    Two domain differences that matter:
    - VerticalFlip is right for dermoscopy (a mole upside-down is still a mole)
      but WRONG for faces — the app only ever sees upright faces, so training on
      flipped ones burns capacity on a distribution that never occurs.
    - Camera degradation (phone/iPad realism) must stay mild: too much and the
      model can't learn the signal. Over-strong values cost skin-type ~13 F1 pts.
    """
    geo = [
        A.RandomResizedCrop(size=(IMG_SIZE, IMG_SIZE), scale=(0.7, 1.0)),
        A.HorizontalFlip(p=0.5),
    ]
    if not face:
        geo.append(A.VerticalFlip(p=0.5))
    return A.Compose([
        *geo,
        A.ColorJitter(brightness=0.2, contrast=0.2, saturation=0.1, hue=0.02, p=0.5),
        # Phone/iPad camera simulation: the app's real inputs are handheld camera
        # frames re-encoded to JPEG, not clean dataset photos — compression
        # artifacts, sensor noise, slight motion blur, exposure swings.
        A.ImageCompression(quality_range=(55, 95), p=0.3),
        A.GaussNoise(std_range=(0.01, 0.04), p=0.2),
        A.MotionBlur(blur_limit=(3, 5), p=0.15),
        A.RandomBrightnessContrast(brightness_limit=0.15, contrast_limit=0.15, p=0.3),
        A.Normalize(**NORM),
        ToTensorV2(),
    ])
