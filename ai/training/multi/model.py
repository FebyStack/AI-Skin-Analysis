"""Shared-trunk, multi-head face model.

EfficientNet-B0 backbone (ImageNet-pretrained) + one small Linear head per task.
The backbone is ~99% of the weights, so N tasks cost ~one model instead of N.
"""
from __future__ import annotations

import torch
from torch import nn
from torchvision.models import EfficientNet_B0_Weights, efficientnet_b0

from ai.training.multi.tasks import TASKS


class MultiHeadNet(nn.Module):
    def __init__(self, tasks: dict[str, list[str]] | None = None, pretrained: bool = True):
        super().__init__()
        tasks = tasks or TASKS
        base = efficientnet_b0(weights=EfficientNet_B0_Weights.IMAGENET1K_V1 if pretrained else None)
        self.features = base.features
        self.avgpool = base.avgpool
        self.dropout = nn.Dropout(0.2)
        in_features = base.classifier[1].in_features
        self.task_names = list(tasks)
        self.heads = nn.ModuleDict({t: nn.Linear(in_features, len(c)) for t, c in tasks.items()})

    def trunk(self, x: torch.Tensor) -> torch.Tensor:
        return self.dropout(torch.flatten(self.avgpool(self.features(x)), 1))

    def forward(self, x: torch.Tensor) -> tuple[torch.Tensor, ...]:
        z = self.trunk(x)
        # Tuple in TASKS order → ONNX outputs logits_<task> in the same order.
        return tuple(self.heads[t](z) for t in self.task_names)


def output_names() -> list[str]:
    return [f"logits_{t}" for t in TASKS]
