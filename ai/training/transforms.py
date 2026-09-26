"""SINGLE source of preprocessing. Training and serving both import from here —
never duplicate these transforms (train/serve skew is the failure mode this kills)."""
import albumentations as A
import numpy as np
from albumentations.pytorch import ToTensorV2

IMG_SIZE = 224
NORM = dict(mean=(0.485, 0.456, 0.406), std=(0.229, 0.224, 0.225))

def shades_of_gray(img: np.ndarray, p: int = 6) -> np.ndarray:
    """Colour constancy (Finlayson & Trezzi 2004): estimate the scene illuminant as the
    per-channel p-norm and divide it out. A grey illuminant is left unchanged.

    Measured 2026-09-21 on the frozen exam: room-light colour alone changed 16-19% of acne
    grades. Runs at 224px, after resize and before Normalize, so the browser port
    (ai/face/analyzers/face-model.ts) can apply it at the same point.
    """
    x = img.astype(np.float32)
    illum = np.power(np.mean(np.power(x, p), axis=(0, 1)), 1.0 / p)
    illum = illum / (np.linalg.norm(illum) + 1e-6)
    return np.clip(x / (illum * np.sqrt(3.0)), 0, 255).astype(np.uint8)


class ShadesOfGray(A.ImageOnlyTransform):
    def __init__(self, p: float = 1.0):
        super().__init__(p=p)

    def apply(self, img, **params):
        return shades_of_gray(img)


def serve_transforms(color_constancy: bool = False) -> A.Compose:
    return A.Compose([
        A.Resize(IMG_SIZE, IMG_SIZE),
        *([ShadesOfGray()] if color_constancy else []),
        A.Normalize(**NORM),
        ToTensorV2(),
    ])

def train_transforms(face: bool = False, lighting: bool = False,
                     color_constancy: bool = False) -> A.Compose:
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
    # Clinic rooms vary in bulb colour and brightness. Colour temperature follows the
    # black-body curve rather than a free hue shift — redness and pigmentation ARE colour,
    # so rotating hue would teach the model to ignore what it must see.
    light = [
        A.PlanckianJitter(mode="blackbody", temperature_limit=(3000, 9000), p=0.6),
        A.RandomGamma(gamma_limit=(70, 150), p=0.4),
    ] if lighting else []
    return A.Compose([
        *geo,
        *light,
        A.ColorJitter(brightness=0.2, contrast=0.2, saturation=0.1, hue=0.02, p=0.5),
        # Phone/iPad camera simulation: the app's real inputs are handheld camera
        # frames re-encoded to JPEG, not clean dataset photos — compression
        # artifacts, sensor noise, slight motion blur, exposure swings.
        A.ImageCompression(quality_range=(55, 95), p=0.3),
        A.GaussNoise(std_range=(0.01, 0.04), p=0.2),
        A.MotionBlur(blur_limit=(3, 5), p=0.15),
        A.RandomBrightnessContrast(brightness_limit=0.15, contrast_limit=0.15, p=0.3),
        *([ShadesOfGray()] if color_constancy else []),
        A.Normalize(**NORM),
        ToTensorV2(),
    ])
