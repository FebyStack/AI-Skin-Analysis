"""Task registry + dataset for the single multi-head face model.

One shared backbone predicts every facial task in one forward pass, instead of a
separate 15MB EfficientNet per task. The PWA then loads ONE model and runs ONE
inference per view — the difference between ~34MB/10 passes and ~15MB/5 passes on
a phone. Multi-task training also regularizes: the trunk sees every image, so
each task benefits from the others' data.

Adding a task = one entry in TASKS + a source in collect_rows().
"""
from __future__ import annotations

import numpy as np
from PIL import Image
from torch.utils.data import Dataset

from ai.training.acne.ingest import collect_all as acne_rows
from ai.training.acne.labels import ACNE_CLASSES
from ai.training.skintype.ingest import collect_all as skintype_rows
from ai.training.skintype.labels import SKIN_TYPE_CLASSES
from ai.training.transforms import serve_transforms, train_transforms

# Ordered: the ONNX outputs are named logits_<task> in this order.
TASKS: dict[str, list[str]] = {
    "acne": ACNE_CLASSES,
    "skintype": SKIN_TYPE_CLASSES,
}


def collect_rows() -> list[dict]:
    """Every labeled image across all tasks, each row tagged with its task."""
    rows: list[dict] = []
    for task, source in (("acne", acne_rows), ("skintype", skintype_rows)):
        for r in source():
            rows.append({**r, "task": task})
    return rows


def task_counts(rows: list[dict]) -> dict[str, int]:
    counts: dict[str, int] = {t: 0 for t in TASKS}
    for r in rows:
        counts[r["task"]] = counts.get(r["task"], 0) + 1
    return counts


class MultiTaskDataset(Dataset):
    """Yields (image, task_index, label_index). Each sample carries exactly one
    task's label — the train loop masks the loss to that task's head."""

    def __init__(self, rows: list[dict], training: bool):
        self.rows = rows
        self.task_index = {t: i for i, t in enumerate(TASKS)}
        self.label_index = {t: {c: i for i, c in enumerate(cs)} for t, cs in TASKS.items()}
        self.tf = train_transforms(face=True) if training else serve_transforms()

    def __len__(self) -> int:
        return len(self.rows)

    def __getitem__(self, i: int):
        r = self.rows[i]
        img = np.array(Image.open(r["path"]).convert("RGB"))
        return (
            self.tf(image=img)["image"],
            self.task_index[r["task"]],
            self.label_index[r["task"]][r["label"]],
        )
