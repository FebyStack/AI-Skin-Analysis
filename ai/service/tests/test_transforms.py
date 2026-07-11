import numpy as np
from ai.training.transforms import serve_transforms, IMG_SIZE

def test_serve_transform_shape_and_norm():
    rgb = np.full((300, 400, 3), 128, dtype=np.uint8)
    out = serve_transforms()(image=rgb)["image"]
    assert tuple(out.shape) == (3, IMG_SIZE, IMG_SIZE)
    # imagenet-normalized mid-gray must be near zero, not 128
    assert abs(float(out.mean())) < 1.0

def test_serve_transform_deterministic():
    rgb = np.random.default_rng(7).integers(0, 255, (256, 256, 3), dtype=np.uint8)
    a = serve_transforms()(image=rgb)["image"]
    b = serve_transforms()(image=rgb)["image"]
    assert bool((a == b).all())
