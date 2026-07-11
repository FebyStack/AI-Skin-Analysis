import cv2
import numpy as np

MIN_EDGE_PX = 224
BLUR_MIN_LAPLACIAN_VAR = 60.0
BRIGHTNESS_MIN = 0.12
BRIGHTNESS_MAX = 0.92

def assess(bgr: np.ndarray) -> tuple[bool, list[str]]:
    """Hard server-side quality gate. Returns (ok, issues)."""
    issues: list[str] = []
    h, w = bgr.shape[:2]
    if min(h, w) < MIN_EDGE_PX:
        issues.append("low-resolution")
    gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
    if cv2.Laplacian(gray, cv2.CV_64F).var() < BLUR_MIN_LAPLACIAN_VAR:
        issues.append("blur")
    mean = float(gray.mean()) / 255.0
    if mean < BRIGHTNESS_MIN:
        issues.append("too-dark")
    elif mean > BRIGHTNESS_MAX:
        issues.append("too-bright")
    return (len(issues) == 0, issues)
