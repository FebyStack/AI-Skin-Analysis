import numpy as np
from ai.service.quality import assess

def _noise(h=400, w=400, lum=128):
    rng = np.random.default_rng(0)
    img = rng.integers(0, 255, (h, w, 3), dtype=np.uint8)
    return (img * 0 + lum + (img % 40) - 20).clip(0, 255).astype(np.uint8)

def test_good_image_passes():
    ok, issues = assess(_noise())
    assert ok and issues == []

def test_tiny_image_flags_resolution():
    ok, issues = assess(_noise(h=100, w=100))
    assert not ok and "low-resolution" in issues

def test_flat_dark_image_flags():
    dark = np.full((400, 400, 3), 8, dtype=np.uint8)
    ok, issues = assess(dark)
    assert not ok and "too-dark" in issues and "blur" in issues
