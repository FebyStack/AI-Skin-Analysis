# ai/training/dataset.py
import numpy as np
from PIL import Image
from torch.utils.data import Dataset
from ai.training.transforms import train_transforms, serve_transforms

class LesionDataset(Dataset):
    def __init__(self, rows: list[dict], classes: list[str], training: bool):
        self.rows, self.classes = rows, classes
        self.idx = {c: i for i, c in enumerate(classes)}
        self.tf = train_transforms() if training else serve_transforms()

    def __len__(self): return len(self.rows)

    def __getitem__(self, i):
        r = self.rows[i]
        img = np.array(Image.open(r["path"]).convert("RGB"))
        return self.tf(image=img)["image"], self.idx[r["label"]]
