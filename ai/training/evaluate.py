# ai/training/evaluate.py
import json
from pathlib import Path
import torch
from torch.utils.data import DataLoader
from torchvision.models import efficientnet_b0
from sklearn.metrics import f1_score, recall_score
from ai.training.dataset import LesionDataset

def load_model(model_dir: str | Path) -> tuple[torch.nn.Module, list[str]]:
    model_dir = Path(model_dir)
    meta = json.loads((model_dir / "model.json").read_text())
    net = efficientnet_b0(num_classes=len(meta["classes"]))
    # weights_only=True: refuse pickled code — a tampered .pt must not execute anything
    net.load_state_dict(torch.load(model_dir / "current.pt", map_location="cpu", weights_only=True))
    return net.eval(), meta["classes"]

def write_candidate_metrics(model_dir: str | Path, metrics: dict) -> None:
    """Persist evaluation metrics into <model_dir>/model.json so the promotion gate can read them."""
    path = Path(model_dir) / "model.json"
    meta = json.loads(path.read_text())
    meta["metrics"] = {**(meta.get("metrics") or {}), **metrics}
    path.write_text(json.dumps(meta, indent=2))

def evaluate(model_dir: str | Path, test_rows: list[dict], classes: list[str]) -> dict:
    net, _ = load_model(model_dir)
    dl = DataLoader(LesionDataset(test_rows, classes, training=False), batch_size=32)
    preds, gts = [], []
    with torch.no_grad():
        for x, y in dl:
            preds += net(x).argmax(1).tolist()
            gts += y.tolist()
    if "Melanoma" not in classes:
        raise ValueError('classes must include "Melanoma"')
    mel = classes.index("Melanoma")
    return {
        "val_macro_f1": float(f1_score(gts, preds, average="macro", zero_division=0)),
        "melanoma_sensitivity": float(recall_score(gts, preds, labels=[mel], average="macro", zero_division=0)),
    }
