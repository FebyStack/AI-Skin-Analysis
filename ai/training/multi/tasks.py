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
from ai.training.dimension.ingest import SEVERITY_DIMENSIONS, collect_for
from ai.training.dimension.labels import PRESENCE_CLASSES
from ai.training.skintype.ingest import collect_all as skintype_rows
from ai.training.skintype.labels import SKIN_TYPE_CLASSES
from ai.training.transforms import serve_transforms, train_transforms

# A dimension joins training only once BOTH classes have this many examples.
# Below it the head cannot beat the pixel heuristic it would replace, and
# shipping a worse model that LOOKS authoritative (a real model confidence in
# the UI) is worse than shipping the honest estimate.
#
# Two classes rather than four means the bar is 80 images, not 160.
MIN_PER_CLASS = 40


def ready_dimensions() -> list[str]:
    """Severity dimensions with enough clinician-graded data to train."""
    ready = []
    for dim in SEVERITY_DIMENSIONS:
        counts = {}
        for r in collect_for(dim):
            counts[r["label"]] = counts.get(r["label"], 0) + 1
        if counts and all(counts.get(c, 0) >= MIN_PER_CLASS for c in PRESENCE_CLASSES):
            ready.append(dim)
    return ready


def build_tasks() -> dict[str, list[str]]:
    """
    Ordered task registry. acne and skintype stay FIRST and in this order:
    older exported models are consumed by output index in some paths, so
    prepending or reordering them would silently mis-map predictions.
    """
    tasks: dict[str, list[str]] = {
        "acne": ACNE_CLASSES,
        "skintype": SKIN_TYPE_CLASSES,
    }
    for dim in ready_dimensions():
        tasks[dim] = PRESENCE_CLASSES
    return tasks


# Evaluated at import so the trainer, evaluator and exporter agree within a run.
TASKS: dict[str, list[str]] = build_tasks()


def collect_rows() -> list[dict]:
    """Every labeled image across all tasks, each row tagged with its task."""
    rows: list[dict] = []
    for r in acne_rows():
        rows.append({**r, "task": "acne"})
    for r in skintype_rows():
        rows.append({**r, "task": "skintype"})
    for dim in TASKS:
        if dim in ("acne", "skintype"):
            continue
        for r in collect_for(dim):
            rows.append({**r, "task": dim})
    return rows


def task_counts(rows: list[dict]) -> dict[str, int]:
    counts: dict[str, int] = {t: 0 for t in TASKS}
    for r in rows:
        counts[r["task"]] = counts.get(r["task"], 0) + 1
    return counts


class MultiTaskDataset(Dataset):
    """Yields (image, task_index, label_index). Each sample carries exactly one
    task's label — the train loop masks the loss to that task's head."""

    def __init__(self, rows: list[dict], training: bool, lighting: bool = False,
                 color_constancy: bool = False):
        self.rows = rows
        self.task_index = {t: i for i, t in enumerate(TASKS)}
        self.label_index = {t: {c: i for i, c in enumerate(cs)} for t, cs in TASKS.items()}
        self.tf = (train_transforms(face=True, lighting=lighting, color_constancy=color_constancy)
                   if training else serve_transforms(color_constancy=color_constancy))

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
