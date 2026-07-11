# ai/training/train.py
import json
from collections import Counter
from pathlib import Path
import numpy as np
import torch
from torch.utils.data import DataLoader
from torchvision.models import efficientnet_b0
from sklearn.metrics import f1_score
from ai.training.dataset import LesionDataset

def _device() -> str:
    if torch.backends.mps.is_available(): return "mps"
    if torch.cuda.is_available(): return "cuda"
    return "cpu"

def train_one(train_rows, val_rows, classes, epochs=15, out_dir=Path("ai/models/candidate"),
              seed=0, lr=1e-3, batch=32, version="candidate") -> dict:
    torch.manual_seed(seed)
    dev = _device()
    net = efficientnet_b0(num_classes=len(classes)).to(dev)
    # class weights fight imbalance (melanoma is rarer than nevi)
    counts = Counter(r["label"] for r in train_rows)
    w = torch.tensor([1.0 / max(counts.get(c, 1), 1) for c in classes], dtype=torch.float32, device=dev)
    loss_fn = torch.nn.CrossEntropyLoss(weight=w)
    opt = torch.optim.AdamW(net.parameters(), lr=lr)
    tl = DataLoader(LesionDataset(train_rows, classes, True), batch_size=batch, shuffle=True)
    vl = DataLoader(LesionDataset(val_rows, classes, False), batch_size=batch)

    for _ in range(epochs):
        net.train()
        for x, y in tl:
            opt.zero_grad(); loss_fn(net(x.to(dev)), y.to(dev)).backward(); opt.step()

    net.eval(); preds, gts = [], []
    with torch.no_grad():
        for x, y in vl:
            preds += net(x.to(dev)).argmax(1).cpu().tolist(); gts += y.tolist()
    macro_f1 = float(f1_score(gts, preds, average="macro", zero_division=0))

    out_dir.mkdir(parents=True, exist_ok=True)
    torch.save(net.state_dict(), out_dir / "current.pt")
    meta = {"name": "efficientnet-b0", "version": version, "classes": classes,
            "img_size": 224, "metrics": {"val_macro_f1": macro_f1}, "dataset_manifest_sha256": None}
    (out_dir / "model.json").write_text(json.dumps(meta, indent=2))
    return {"val_macro_f1": macro_f1}
