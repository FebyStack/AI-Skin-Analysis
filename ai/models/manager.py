from pathlib import Path
from ultralytics import YOLO
import torch


BASE_DIR = Path(__file__).resolve().parent          # ai/models
REPO_ROOT = BASE_DIR.parent.parent                   # project root
# MediaPipe task file is served to the browser from here; reuse it server-side.
FACE_TASK = REPO_ROOT / "frontend" / "public" / "models" / "face_landmarker.task"


class ModelManager:
    """
    Lazy singleton for every AI model. Each model loads once on first access
    and is cached. Adding a model = one more property here (no other refactor).
    """

    def __init__(self):
        self._yolo = None
        self._classifier = None
        self._face = None
        self._mobile_sam = None


    @property
    def yolo(self):
        if self._yolo is None:
            print("Loading YOLO11...")
            self._yolo = YOLO(BASE_DIR / "detector/yolo11n.pt")
        return self._yolo


    @property
    def classifier(self):
        if self._classifier is None:
            print("Loading lesion classifier...")
            from ai.inference.lesion_classifier import LesionClassifier
            self._classifier = LesionClassifier()
        return self._classifier


    @property
    def mobile_sam(self):
        if self._mobile_sam is None:
            print("Loading MobileSAM...")
            # weights_only=True: refuse pickled code on load.
            self._mobile_sam = torch.load(
                BASE_DIR / "segmentation/mobile_sam.pt",
                map_location=self.device,
                weights_only=True,
            )
        return self._mobile_sam


    @property
    def face(self):
        if self._face is None:
            print("Loading MediaPipe Face Landmarker...")
            import mediapipe as mp

            self._face = mp.tasks.vision.FaceLandmarker.create_from_options(
                mp.tasks.vision.FaceLandmarkerOptions(
                    base_options=mp.tasks.BaseOptions(
                        model_asset_path=str(FACE_TASK)
                    ),
                    running_mode=mp.tasks.vision.RunningMode.IMAGE,
                )
            )
        return self._face


    @property
    def device(self):
        return "mps" if torch.backends.mps.is_available() else "cpu"


models = ModelManager()
