import numpy as np
import torch

from ai.training.multi.export_onnx import ColorConstancyInGraph
from ai.training.transforms import IMG_SIZE, NORM, serve_transforms

# float64, like the JS constants in ai/face/analyzers/face-model.ts
MEAN = np.array(NORM["mean"]).reshape(3, 1, 1)
STD = np.array(NORM["std"]).reshape(3, 1, 1)


def _grey_levels_off(img: np.ndarray) -> np.ndarray:
    """|exported graph − training| in 0..255 units for one 224px RGB image."""
    want = serve_transforms(color_constancy=True)(image=img)["image"].numpy()
    x = ((img.transpose(2, 0, 1) / 255 - MEAN) / STD).astype(np.float32)  # what the PWA feeds
    got = ColorConstancyInGraph(torch.nn.Identity())(torch.from_numpy(x[None]))[0].numpy()
    return np.abs(got - want) * STD * 255


def test_in_graph_color_constancy_matches_training():
    """The export bakes shades_of_gray into the graph so the PWA cannot drift from
    training. Without its uint8 truncation every corrected pixel came out 0.3-0.5
    grey levels brighter than anything the model was trained on."""
    rng = np.random.default_rng(0)
    yy, xx = np.mgrid[0:IMG_SIZE, 0:IMG_SIZE]
    warm_gradient = np.stack([150 + xx * 0.4, 110 + yy * 0.3, np.full_like(xx, 70)], -1)
    warm_noise = rng.integers(0, 256, (IMG_SIZE, IMG_SIZE, 3)) * [1.0, 0.8, 0.55]
    for img in (warm_gradient, warm_noise):
        off = _grey_levels_off(img.astype(np.uint8))
        assert off.mean() < 0.01 and off.max() <= 1
