"""Train the single multi-head face model (acne + skin type in one network).

    .venv/bin/python -m ai.training.multi.train_multi --epochs 12

Each sample carries one task's label, so the loss is masked to that task's head;
the shared trunk still learns from every image. Output → ai/models/face/candidate/.
Then evaluate + export_onnx. Replaces the separate acne/ and skintype/ models in
the browser: one download, one forward pass per view.
"""
from __future__ import annotations

import argparse
import json
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

import torch
from sklearn.metrics import f1_score
from torch.utils.data import DataLoader

import numpy as np
from sklearn.model_selection import StratifiedGroupKFold

from ai.training.build_master import split_rows
from ai.training.multi.freeze_test import rel_key
from ai.training.multi.model import MultiHeadNet
from ai.training.multi.tasks import TASKS, MultiTaskDataset, collect_rows, task_counts
from ai.training.train import _device, _tb_writer, _write_progress

OUT_DIR = Path("ai/models/face/candidate")


def _loss_fn(train_rows: list[dict], dev: str) -> dict[str, torch.nn.CrossEntropyLoss]:
    """Per-task weighted CE — rare classes (e.g. very-severe acne) count more."""
    fns = {}
    for task, classes in TASKS.items():
        counts = Counter(r["label"] for r in train_rows if r["task"] == task)
        w = torch.tensor([1.0 / max(counts.get(c, 1), 1) for c in classes],
                         dtype=torch.float32, device=dev)
        fns[task] = torch.nn.CrossEntropyLoss(weight=w)
    return fns


def _split_excluding(rows: list[dict], frozen: dict, seed: int) -> tuple[list[dict], list[dict]]:
    """Train/val from everything outside the frozen exam — its images and their groups."""
    paths, groups = set(frozen["paths"]), set(frozen["groups"])
    pool = [r for r in rows if rel_key(r["path"]) not in paths and r["group"] not in groups]
    y = np.array([r["label"] for r in pool]); g = np.array([r["group"] for r in pool])
    sgkf = StratifiedGroupKFold(n_splits=6, shuffle=True, random_state=seed)
    tr, va = next(sgkf.split(np.arange(len(pool)), y, g))
    return [pool[i] for i in tr], [pool[i] for i in va]


def _evaluate(net: MultiHeadNet, loader: DataLoader, dev: str) -> dict[str, float]:
    """Macro-F1 per task, plus their mean as the headline number."""
    net.eval()
    preds: dict[int, list[int]] = {i: [] for i in range(len(TASKS))}
    gts: dict[int, list[int]] = {i: [] for i in range(len(TASKS))}
    with torch.no_grad():
        for x, task_idx, y in loader:
            outs = net(x.to(dev))
            for ti in range(len(TASKS)):
                m = task_idx == ti
                if not bool(m.any()):
                    continue
                preds[ti] += outs[ti][m.to(dev)].argmax(1).cpu().tolist()
                gts[ti] += y[m].tolist()
    scores = {}
    for ti, task in enumerate(TASKS):
        scores[task] = (
            float(f1_score(gts[ti], preds[ti], average="macro", zero_division=0))
            if gts[ti] else 0.0
        )
    scores["mean"] = sum(scores[t] for t in TASKS) / len(TASKS)
    return scores


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--epochs", type=int, default=12)
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--lr", type=float, default=1e-3)
    ap.add_argument("--batch", type=int, default=32)
    ap.add_argument("--lighting-aug", action="store_true",
                    help="colour-temperature + exposure augmentation")
    ap.add_argument("--color-constancy", action="store_true",
                    help="Shades-of-Grey white balance at train AND serve (recorded in model.json)")
    ap.add_argument("--frozen-test", type=Path, default=None,
                    help="frozen_test.json from freeze_test; kept out of train/val")
    args = ap.parse_args(argv)

    rows = collect_rows()
    if not rows:
        print("No training data. Fetch the acne + skintype datasets first.")
        return 1
    print(f"multi rows: {len(rows)}  by task: {task_counts(rows)}")

    torch.manual_seed(args.seed)
    dev = _device()
    if args.frozen_test:
        train_rows, val_rows = _split_excluding(
            rows, json.loads(args.frozen_test.read_text()), args.seed)
        print(f"frozen exam held out; train {len(train_rows)}  val {len(val_rows)}")
    else:
        train_rows, val_rows, _test = split_rows(rows, seed=args.seed)
    net = MultiHeadNet().to(dev)
    losses = _loss_fn(train_rows, dev)
    opt = torch.optim.AdamW(net.parameters(), lr=args.lr)
    # Flat LR left val F1 oscillating around 0.52 from epoch 4 while train loss
    # kept falling to 0.83 — the step size stayed too large to settle. Cosine
    # decay lets the late epochs refine instead of re-crossing the same minimum.
    sched = torch.optim.lr_scheduler.CosineAnnealingLR(opt, T_max=args.epochs)
    pre = {"lighting": args.lighting_aug, "color_constancy": args.color_constancy}
    tl = DataLoader(MultiTaskDataset(train_rows, True, **pre), batch_size=args.batch, shuffle=True)
    vl = DataLoader(MultiTaskDataset(val_rows, False, color_constancy=args.color_constancy),
                    batch_size=args.batch)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    version = f"face-{datetime.now(timezone.utc).strftime('%Y%m%d-%H%M%S')}"
    writer = _tb_writer(version)
    history, scores = [], {}
    # Val macro-F1 is noisy across epochs (0.539 @4, 0.482 @7, 0.557 @12), so the
    # LAST epoch is not the best one — it only happened to be, in the 2026-07-31
    # run that shipped. Keep the best checkpoint, not the final one.
    best_f1, best_scores, best_epoch = -1.0, {}, 0

    for epoch in range(1, args.epochs + 1):
        net.train()
        running, nb = 0.0, 0
        for x, task_idx, y in tl:
            x, y = x.to(dev), y.to(dev)
            outs = net(x)
            loss = torch.zeros((), device=dev)
            for ti, task in enumerate(TASKS):
                m = (task_idx == ti).to(dev)
                if bool(m.any()):
                    loss = loss + losses[task](outs[ti][m], y[m])
            opt.zero_grad()
            loss.backward()
            opt.step()
            running += float(loss.detach())
            nb += 1
        train_loss = running / max(nb, 1)
        scores = _evaluate(net, vl, dev)
        sched.step()
        if scores["mean"] > best_f1:
            best_f1, best_scores, best_epoch = scores["mean"], dict(scores), epoch
            torch.save(net.state_dict(), OUT_DIR / "current.pt")
        history.append({"epoch": epoch, "train_loss": round(train_loss, 4),
                        "val_macro_f1": round(scores["mean"], 4)})
        if writer:
            writer.add_scalar("loss/train", train_loss, epoch)
            for t, s in scores.items():
                writer.add_scalar(f"f1/val_{t}", s, epoch)
        _write_progress(OUT_DIR / "progress.json", version, epoch, args.epochs,
                        train_loss, scores["mean"], history, done=False)
        print(f"  epoch {epoch}/{args.epochs} loss={train_loss:.4f} " +
              " ".join(f"{t}={scores[t]:.3f}" for t in TASKS) +
              (f"  *best({best_f1:.4f})" if best_epoch == epoch else ""))

    print(f"best epoch {best_epoch}: {best_f1:.4f}")
    (OUT_DIR / "model.json").write_text(json.dumps({
        "name": "efficientnet-b0-multihead", "version": version,
        "tasks": {t: c for t, c in TASKS.items()}, "img_size": 224,
        "best_epoch": best_epoch,
        # Serving must apply the same preprocessing the model was trained with.
        "preprocess": {"color_constancy": args.color_constancy},
        "metrics": {"val_macro_f1": best_scores["mean"],
                    **{f"val_macro_f1_{t}": best_scores[t] for t in TASKS}},
    }, indent=2))
    _write_progress(OUT_DIR / "progress.json", version, args.epochs, args.epochs,
                    history[-1]["train_loss"], best_scores["mean"], history, done=True)
    if writer:
        writer.close()
    print(f"trained {version} → {OUT_DIR} (mean val_macro_f1={best_scores['mean']:.3f})")
    print("Next: .venv/bin/python -m ai.training.multi.evaluate && ...export_onnx")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
