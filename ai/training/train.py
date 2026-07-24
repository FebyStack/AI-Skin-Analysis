# ai/training/train.py
import json
from collections import Counter
from pathlib import Path
import numpy as np
import torch
from torch.utils.data import DataLoader
from torchvision.models import efficientnet_b0, EfficientNet_B0_Weights
from sklearn.metrics import f1_score
from ai.training.dataset import LesionDataset

def _device() -> str:
    if torch.backends.mps.is_available(): return "mps"
    if torch.cuda.is_available(): return "cuda"
    return "cpu"

def _tb_writer(version: str):
    """Optional TensorBoard writer → ai/models/runs/<version> (None if TB absent)."""
    try:
        from torch.utils.tensorboard import SummaryWriter
        return SummaryWriter(str(Path("ai/models/runs") / version))
    except Exception:
        return None

def _write_progress(path: Path, version, epoch, total, train_loss, val_f1, history, done) -> None:
    # Live per-epoch progress the in-app training dashboard polls (GET /api/training/<dim>/progress).
    path.write_text(json.dumps({
        "version": version, "epoch": epoch, "total_epochs": total,
        "train_loss": round(train_loss, 4), "val_macro_f1": round(val_f1, 4),
        "history": history, "done": done,
    }, indent=2))

def train_one(train_rows, val_rows, classes, epochs=15, out_dir=Path("ai/models/candidate"),
              seed=0, lr=1e-3, batch=32, version="candidate") -> dict:
    torch.manual_seed(seed)
    dev = _device()
    # Transfer learning: ImageNet-pretrained backbone + a fresh head sized to our
    # classes. Training from scratch on a few hundred images gives ~random results;
    # fine-tuning a pretrained net converges in a few epochs. (~20MB weights are
    # downloaded once and cached in ~/.cache/torch.) Same architecture as
    # efficientnet_b0(num_classes=…), so export/evaluate load the state_dict as-is.
    net = efficientnet_b0(weights=EfficientNet_B0_Weights.IMAGENET1K_V1)
    net.classifier[1] = torch.nn.Linear(net.classifier[1].in_features, len(classes))
    net = net.to(dev)
    # class weights fight imbalance (melanoma is rarer than nevi)
    counts = Counter(r["label"] for r in train_rows)
    w = torch.tensor([1.0 / max(counts.get(c, 1), 1) for c in classes], dtype=torch.float32, device=dev)
    loss_fn = torch.nn.CrossEntropyLoss(weight=w)
    opt = torch.optim.AdamW(net.parameters(), lr=lr)
    tl = DataLoader(LesionDataset(train_rows, classes, True), batch_size=batch, shuffle=True)
    vl = DataLoader(LesionDataset(val_rows, classes, False), batch_size=batch)

    out_dir.mkdir(parents=True, exist_ok=True)
    progress_path = out_dir / "progress.json"
    writer = _tb_writer(version)

    def val_macro_f1() -> float:
        net.eval(); preds, gts = [], []
        with torch.no_grad():
            for x, y in vl:
                preds += net(x.to(dev)).argmax(1).cpu().tolist(); gts += y.tolist()
        return float(f1_score(gts, preds, average="macro", zero_division=0))

    history, macro_f1 = [], 0.0
    for epoch in range(1, epochs + 1):
        net.train(); running, nb = 0.0, 0
        for x, y in tl:
            opt.zero_grad(); loss = loss_fn(net(x.to(dev)), y.to(dev)); loss.backward(); opt.step()
            running += float(loss.detach()); nb += 1
        train_loss = running / max(nb, 1)
        macro_f1 = val_macro_f1()   # per-epoch val → a real training curve
        history.append({"epoch": epoch, "train_loss": round(train_loss, 4), "val_macro_f1": round(macro_f1, 4)})
        if writer:
            writer.add_scalar("loss/train", train_loss, epoch)
            writer.add_scalar("f1/val_macro", macro_f1, epoch)
        _write_progress(progress_path, version, epoch, epochs, train_loss, macro_f1, history, done=False)

    torch.save(net.state_dict(), out_dir / "current.pt")
    meta = {"name": "efficientnet-b0", "version": version, "classes": classes,
            "img_size": 224, "metrics": {"val_macro_f1": macro_f1}, "dataset_manifest_sha256": None}
    (out_dir / "model.json").write_text(json.dumps(meta, indent=2))
    _write_progress(progress_path, version, epochs, epochs,
                    history[-1]["train_loss"] if history else 0.0, macro_f1, history, done=True)
    if writer:
        writer.close()
    return {"val_macro_f1": macro_f1}
