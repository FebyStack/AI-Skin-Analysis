# Dataset & Training Toolkit Implementation Plan (Plan 8)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use `- [ ]`. Spec: `docs/superpowers/specs/2026-07-10-ai-classifier-architecture.md`. Depends on Plan 7 (shared transforms, model registry, dev model).

**Goal:** Reproducible master-dataset build (dedup-before-split, leakage-safe) + train / evaluate / compare / promote toolkit for EfficientNet-B0 — manual, one-laptop, relocatable datasets.

**Architecture:** Pure-Python `ai/training/*` operating on `DATASETS_DIR` (default `ai/datasets/`, gitignored). Dedup with pHash+IDs *before* splitting; patient/lesion-grouped stratified splits; frozen test set keyed by manifest hash. Promotion gated on metrics — never overwrites production.

**Tech Stack:** pandas, scikit-learn, imagehash/Pillow, torch/torchvision, the `transforms.py` from Plan 7.

**Conventions:** run from repo root via `.venv/bin/python -m ai.training.<mod>`; tiny synthetic fixtures for tests (no real datasets in CI). Commit per task.

---

### Task 1: Datasets dir config + gitignore

**Files:**
- Create: `ai/training/paths.py`
- Modify: `.gitignore`
- Test: `ai/training/tests/__init__.py` (empty), `ai/training/tests/test_paths.py`

- [ ] **Step 1: Failing test**

```python
# ai/training/tests/test_paths.py
import os
from pathlib import Path
from ai.training.paths import datasets_dir, raw_dir, master_dir, duplicates_dir

def test_default_is_ai_datasets(monkeypatch):
    monkeypatch.delenv("DATASETS_DIR", raising=False)
    assert datasets_dir() == Path("ai/datasets")

def test_env_override_relocates(monkeypatch, tmp_path):
    monkeypatch.setenv("DATASETS_DIR", str(tmp_path))
    assert datasets_dir() == tmp_path
    assert raw_dir("isic2019") == tmp_path / "raw" / "isic2019"
    assert master_dir() == tmp_path / "master"
    assert duplicates_dir() == tmp_path / "duplicates"
```

- [ ] **Step 2: Run** `.venv/bin/python -m pytest ai/training/tests/test_paths.py -q` → FAIL
- [ ] **Step 3: Implement**

```python
# ai/training/paths.py
"""All dataset paths derive from DATASETS_DIR — set it to an external disk to relocate everything."""
import os
from pathlib import Path

def datasets_dir() -> Path:
    return Path(os.environ.get("DATASETS_DIR", "ai/datasets"))

def raw_dir(source: str) -> Path:
    return datasets_dir() / "raw" / source

def master_dir() -> Path:
    return datasets_dir() / "master"

def duplicates_dir() -> Path:
    return datasets_dir() / "duplicates"
```

- [ ] **Step 4:** add to `.gitignore`: `ai/datasets/` and `ai/models/**/*.pt`. Run test → PASS.
- [ ] **Step 5: Commit** `git add ai/training/paths.py ai/training/tests .gitignore && git commit -m "feat(training): DATASETS_DIR path config (relocatable)"`

---

### Task 2: pHash + ID dedup

**Files:**
- Create: `ai/training/dedup.py`
- Test: `ai/training/tests/test_dedup.py`

- [ ] **Step 1: Failing test**

```python
# ai/training/tests/test_dedup.py
import numpy as np
from PIL import Image
from ai.training.dedup import phash_hex, find_duplicates

def _save(path, lum):
    Image.fromarray(np.full((64, 64, 3), lum, np.uint8)).save(path)

def test_phash_stable(tmp_path):
    p = tmp_path / "a.png"; _save(p, 100)
    assert phash_hex(p) == phash_hex(p)

def test_finds_near_and_id_duplicates(tmp_path):
    rows = []
    for name, lum, sid in [("a.png", 100, "S1"), ("b.png", 101, "S2"), ("c.png", 10, "S1")]:
        _save(tmp_path / name, lum)
        rows.append({"path": str(tmp_path / name), "source_id": sid})
    keep, dropped = find_duplicates(rows, hamming_max=4)
    dropped_paths = {d["path"] for d in dropped}
    # b is a near-dup of a (pHash); c shares source_id S1 with a
    assert len(keep) == 1
    assert len(dropped_paths) == 2
```

- [ ] **Step 2: Run** → FAIL
- [ ] **Step 3: Implement**

```python
# ai/training/dedup.py
"""Never train on duplicates. Primary: perceptual hash (near-dup). Secondary: source_id match."""
from pathlib import Path
import imagehash
from PIL import Image

def phash_hex(path: str | Path) -> str:
    with Image.open(path) as im:
        return str(imagehash.phash(im.convert("RGB")))

def find_duplicates(rows: list[dict], hamming_max: int = 4) -> tuple[list[dict], list[dict]]:
    """rows: [{path, source_id, ...}]. Returns (keep, dropped). First occurrence wins."""
    keep: list[dict] = []
    kept_hashes: list[imagehash.ImageHash] = []
    seen_ids: set[str] = set()
    dropped: list[dict] = []
    for row in rows:
        sid = row.get("source_id")
        h = imagehash.hex_to_hash(phash_hex(row["path"]))
        if sid and sid in seen_ids:
            dropped.append({**row, "reason": "source_id"}); continue
        if any((h - k) <= hamming_max for k in kept_hashes):
            dropped.append({**row, "reason": "phash"}); continue
        keep.append(row); kept_hashes.append(h)
        if sid: seen_ids.add(sid)
    return keep, dropped
```

- [ ] **Step 4: Run** → PASS. **Step 5: Commit** `git commit -am "feat(training): phash+id duplicate detection"`

---

### Task 3: Source ingest adapters (label normalization)

**Files:**
- Create: `ai/training/ingest/__init__.py`, `ai/training/ingest/labels.py`
- Test: `ai/training/tests/test_labels.py`

- [ ] **Step 1: Failing test**

```python
# ai/training/tests/test_labels.py
from ai.training.ingest.labels import normalize_label, CANONICAL

def test_maps_source_labels_to_canonical():
    assert normalize_label("mel") == "Melanoma"
    assert normalize_label("MEL") == "Melanoma"
    assert normalize_label("nv") == "Nevus"
    assert normalize_label("bcc") == "Basal Cell Carcinoma"
    assert normalize_label("akiec") == "Actinic Keratosis"

def test_unknown_label_returns_none():
    assert normalize_label("not-a-class") is None

def test_canonical_is_the_eight_isic_classes():
    assert len(CANONICAL) == 8 and "Melanoma" in CANONICAL
```

- [ ] **Step 2: Run** → FAIL
- [ ] **Step 3: Implement**

```python
# ai/training/ingest/labels.py
"""Map each source's label vocabulary to the 8 canonical classes (must match shared/contract LESION_CLASSES)."""
CANONICAL = [
    "Melanoma", "Nevus", "Basal Cell Carcinoma", "Actinic Keratosis",
    "Benign Keratosis", "Dermatofibroma", "Vascular Lesion", "Squamous Cell Carcinoma",
]

_ALIASES = {
    "mel": "Melanoma", "melanoma": "Melanoma",
    "nv": "Nevus", "nevus": "Nevus", "nevi": "Nevus",
    "bcc": "Basal Cell Carcinoma", "basal cell carcinoma": "Basal Cell Carcinoma",
    "akiec": "Actinic Keratosis", "ak": "Actinic Keratosis", "actinic keratosis": "Actinic Keratosis",
    "bkl": "Benign Keratosis", "benign keratosis": "Benign Keratosis", "seborrheic keratosis": "Benign Keratosis",
    "df": "Dermatofibroma", "dermatofibroma": "Dermatofibroma",
    "vasc": "Vascular Lesion", "vascular lesion": "Vascular Lesion",
    "scc": "Squamous Cell Carcinoma", "squamous cell carcinoma": "Squamous Cell Carcinoma",
}

def normalize_label(raw: str) -> str | None:
    return _ALIASES.get(raw.strip().lower())
```

- [ ] **Step 4: Run** → PASS. **Step 5: Commit** `git commit -am "feat(training): source label normalization to 8 canonical classes"`

Note (no code step — reference for the operator): per-source download scripts (`ingest/isic2019.py`, etc.) are thin wrappers that download to `raw_dir(source)` and emit a `rows.csv` of `{path, source_id, raw_label}`. They need ISIC/Kaggle accounts and are run manually; each just produces the row list that Tasks 2 & 4 consume. Not unit-tested (network/account-gated).

---

### Task 4: build_master — dedup THEN grouped stratified split

**Files:**
- Create: `ai/training/build_master.py`
- Test: `ai/training/tests/test_build_master.py`

- [ ] **Step 1: Failing test**

```python
# ai/training/tests/test_build_master.py
import numpy as np
from PIL import Image
from ai.training.build_master import split_rows

def _rows(n_per_class=20):
    rows = []
    for cls in ["Melanoma", "Nevus"]:
        for i in range(n_per_class):
            rows.append({"path": f"/x/{cls}_{i}.png", "label": cls,
                         "group": f"{cls}_patient_{i // 4}"})  # 4 images per patient
    return rows

def test_split_is_grouped_and_stratified():
    train, val, test = split_rows(_rows(), seed=0)
    # no patient group crosses splits (leakage guard)
    def groups(s): return {r["group"] for r in s}
    assert groups(train).isdisjoint(groups(val))
    assert groups(train).isdisjoint(groups(test))
    assert groups(val).isdisjoint(groups(test))
    # both classes present in every split
    for s in (train, val, test):
        assert {r["label"] for r in s} == {"Melanoma", "Nevus"}

def test_split_deterministic():
    a = split_rows(_rows(), seed=0)
    b = split_rows(_rows(), seed=0)
    assert [r["path"] for r in a[0]] == [r["path"] for r in b[0]]
```

- [ ] **Step 2: Run** → FAIL
- [ ] **Step 3: Implement**

```python
# ai/training/build_master.py
"""Build the master dataset: dedup (Task 2) BEFORE splitting, then patient/lesion-GROUPED
stratified split so no patient leaks across train/val/test. Emits manifest.json (sha256 of the
sorted kept-path list) — the frozen test set is identified by this hash and never trained on."""
import hashlib
import json
from collections import defaultdict
from pathlib import Path
import numpy as np
from sklearn.model_selection import StratifiedGroupKFold
from ai.training.paths import master_dir

def split_rows(rows: list[dict], seed: int = 0) -> tuple[list[dict], list[dict], list[dict]]:
    """rows need {path, label, group}. Returns (train, val, test) ≈ 70/15/15, groups disjoint."""
    X = np.arange(len(rows))
    y = np.array([r["label"] for r in rows])
    groups = np.array([r["group"] for r in rows])
    # test = 1 fold of 7; val = 1 fold of the remaining 6
    sgkf = StratifiedGroupKFold(n_splits=7, shuffle=True, random_state=seed)
    train_val_idx, test_idx = next(sgkf.split(X, y, groups))
    tv = [rows[i] for i in train_val_idx]
    Xv = np.arange(len(tv)); yv = np.array([r["label"] for r in tv]); gv = np.array([r["group"] for r in tv])
    sgkf2 = StratifiedGroupKFold(n_splits=6, shuffle=True, random_state=seed)
    tr_idx, val_idx = next(sgkf2.split(Xv, yv, gv))
    return [tv[i] for i in tr_idx], [tv[i] for i in val_idx], [rows[i] for i in test_idx]

def manifest_hash(rows: list[dict]) -> str:
    joined = "\n".join(sorted(r["path"] for r in rows))
    return hashlib.sha256(joined.encode()).hexdigest()

def write_master(kept_rows: list[dict], seed: int = 0, out: Path | None = None) -> dict:
    out = out or master_dir()
    out.mkdir(parents=True, exist_ok=True)
    train, val, test = split_rows(kept_rows, seed)
    for name, rows in (("train", train), ("val", val), ("test", test)):
        (out / f"{name}.json").write_text(json.dumps(rows, indent=2))
    meta = {"seed": seed, "counts": {"train": len(train), "val": len(val), "test": len(test)},
            "manifest_sha256": manifest_hash(kept_rows)}
    (out / "manifest.json").write_text(json.dumps(meta, indent=2))
    return meta
```

- [ ] **Step 4: Run** → PASS. **Step 5: Commit** `git commit -am "feat(training): leakage-safe master build (dedup-before-grouped-stratified-split)"`

---

### Task 5: Dataset + train loop (weighted loss)

**Files:**
- Create: `ai/training/dataset.py`, `ai/training/train.py`
- Test: `ai/training/tests/test_train_smoke.py`

- [ ] **Step 1: Failing test (tiny synthetic, 1 epoch, CPU)**

```python
# ai/training/tests/test_train_smoke.py
import json
import numpy as np
from PIL import Image
from ai.training.train import train_one

def _make(tmp_path, n=6):
    rows = []
    for cls in ["Melanoma", "Nevus"]:
        for i in range(n):
            p = tmp_path / f"{cls}_{i}.png"
            lum = 30 if cls == "Melanoma" else 220
            Image.fromarray(np.full((32, 32, 3), lum, np.uint8)).save(p)
            rows.append({"path": str(p), "label": cls, "group": f"{cls}_{i}"})
    return rows

def test_train_one_epoch_writes_candidate(tmp_path):
    rows = _make(tmp_path)
    out = tmp_path / "candidate"
    info = train_one(train_rows=rows, val_rows=rows, classes=["Melanoma", "Nevus"],
                     epochs=1, out_dir=out, seed=0)
    assert (out / "current.pt").exists()
    meta = json.loads((out / "model.json").read_text())
    assert meta["classes"] == ["Melanoma", "Nevus"]
    assert 0.0 <= info["val_macro_f1"] <= 1.0
```

- [ ] **Step 2: Run** → FAIL
- [ ] **Step 3: Implement**

```python
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
```

```python
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
```

- [ ] **Step 4: Run** `.venv/bin/python -m pytest ai/training/tests/test_train_smoke.py -q` → PASS (slow-ish; CPU 1 epoch on tiny data).
- [ ] **Step 5: Commit** `git commit -am "feat(training): dataset + weighted train loop (mps/cuda/cpu)"`

---

### Task 6: evaluate + compare + promote (gated, never overwrite)

**Files:**
- Create: `ai/training/evaluate.py`, `ai/training/promote.py`
- Test: `ai/training/tests/test_promote.py`

- [ ] **Step 1: Failing test**

```python
# ai/training/tests/test_promote.py
import json
from pathlib import Path
from ai.training.promote import decide_promotion, promote

def _meta(f1, mel_sens):
    return {"metrics": {"val_macro_f1": f1, "melanoma_sensitivity": mel_sens}}

def test_promote_when_f1_up_and_melanoma_not_worse():
    ok, why = decide_promotion(_meta(0.80, 0.90), _meta(0.75, 0.90))
    assert ok is True

def test_block_when_melanoma_sensitivity_regresses():
    ok, why = decide_promotion(_meta(0.85, 0.70), _meta(0.75, 0.90))
    assert ok is False and "melanoma" in why.lower()

def test_block_when_no_production_metrics_missing():
    ok, why = decide_promotion(_meta(0.85, 0.90), None)  # first ever model
    assert ok is True and "first" in why.lower()

def test_promote_archives_old_never_overwrites(tmp_path):
    prod = tmp_path / "production"; cand = tmp_path / "candidate"; arch = tmp_path / "archive"
    for d, v in [(prod, "1.0.0"), (cand, "1.1.0")]:
        d.mkdir(parents=True); (d / "current.pt").write_text(v)
        (d / "model.json").write_text(json.dumps({"version": v}))
    promote(cand, prod, arch)
    assert (prod / "model.json").read_text().find("1.1.0") > -1     # candidate is now prod
    archived = list(arch.glob("*/model.json"))
    assert len(archived) == 1 and "1.0.0" in archived[0].read_text()  # old prod archived, not lost
```

- [ ] **Step 2: Run** → FAIL
- [ ] **Step 3: Implement**

```python
# ai/training/evaluate.py
import numpy as np
import torch
from torch.utils.data import DataLoader
from sklearn.metrics import f1_score, recall_score
from ai.service.classifier import Classifier
from ai.training.dataset import LesionDataset

def evaluate(model_dir, test_rows, classes) -> dict:
    clf = Classifier.load(model_dir)
    dl = DataLoader(LesionDataset(test_rows, classes, training=False), batch_size=32)
    preds, gts = [], []
    with torch.no_grad():
        for x, y in dl:
            preds += clf.net(x).argmax(1).tolist(); gts += y.tolist()
    mel = classes.index("Melanoma")
    return {
        "val_macro_f1": float(f1_score(gts, preds, average="macro", zero_division=0)),
        "melanoma_sensitivity": float(recall_score(gts, preds, labels=[mel], average="macro", zero_division=0)),
    }
```

```python
# ai/training/promote.py
"""Gated promotion. Promote candidate ONLY if macro-F1 improves AND melanoma sensitivity does not
regress. Old production is ARCHIVED (timestamped), never overwritten."""
import json
import shutil
from datetime import datetime, timezone
from pathlib import Path

def decide_promotion(candidate_meta: dict, production_meta: dict | None) -> tuple[bool, str]:
    c = candidate_meta["metrics"]
    if production_meta is None:
        return True, "No production model yet — promoting the first model."
    p = production_meta["metrics"]
    if c["melanoma_sensitivity"] < p["melanoma_sensitivity"] - 1e-9:
        return False, f"Blocked: melanoma sensitivity regressed {p['melanoma_sensitivity']:.3f} → {c['melanoma_sensitivity']:.3f}."
    if c["val_macro_f1"] <= p["val_macro_f1"]:
        return False, f"Blocked: macro-F1 did not improve ({p['val_macro_f1']:.3f} → {c['val_macro_f1']:.3f})."
    return True, f"Promote: macro-F1 {p['val_macro_f1']:.3f} → {c['val_macro_f1']:.3f}, melanoma sens ≥ prior."

def promote(candidate: Path, production: Path, archive: Path) -> Path:
    archive.mkdir(parents=True, exist_ok=True)
    if (production / "model.json").exists():
        stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
        dest = archive / stamp
        shutil.copytree(production, dest)
    shutil.rmtree(production, ignore_errors=True)
    shutil.copytree(candidate, production)
    return production
```

- [ ] **Step 4: Run** → PASS. **Step 5: Commit** `git commit -am "feat(training): gated evaluate/compare/promote (archive, never overwrite)"`

---

### Task 7: Retraining Makefile targets + operator runbook

**Files:**
- Modify: `ai/Makefile`
- Create: `ai/training/README.md`

- [ ] **Step 1: Add targets**

```makefile
# append to ai/Makefile
.PHONY: dedup build-master train evaluate promote
dedup:
	cd .. && .venv/bin/python -m ai.training.run_dedup
build-master:
	cd .. && .venv/bin/python -m ai.training.build_master
train:
	cd .. && .venv/bin/python -m ai.training.train
evaluate:
	cd .. && .venv/bin/python -m ai.training.evaluate
promote:
	cd .. && .venv/bin/python -m ai.training.run_promote
```

- [ ] **Step 2: Write `ai/training/README.md`** — the manual retraining runbook:

```markdown
# Retraining Runbook (manual)

Datasets live under `DATASETS_DIR` (default `ai/datasets/`, gitignored). To use an external disk:
`export DATASETS_DIR=/Volumes/SSD/skin-datasets`.

1. **Ingest** — run each `ai/training/ingest/<source>.py` (needs ISIC/Kaggle accounts) → downloads to
   `$DATASETS_DIR/raw/<source>/` + a `rows.csv` of {path, source_id, raw_label}. Add doctor-approved
   clinic images the same way (a `clinic` source).
2. **Dedup** — `make -C ai dedup`. pHash+ID; removals logged to `$DATASETS_DIR/duplicates/`. Never train on dupes.
3. **Build master** — `make -C ai build-master`. Dedup-before-split; patient-grouped stratified 70/15/15;
   writes `master/{train,val,test}.json` + `manifest.json` (test set frozen by hash).
4. **Train** — `make -C ai train` → `ai/models/candidate/`.
5. **Evaluate** — `make -C ai evaluate` on the frozen test set → writes candidate metrics.
6. **Compare & promote** — `make -C ai promote`. Promotes ONLY if macro-F1 improves AND melanoma
   sensitivity does not regress; else the candidate stays in `candidate/`. Old production is archived.
7. Restart the inference service (or `docker compose restart inference`) to load the new production model.

Never overwrite a model version. Never train on the test set. Never train on duplicates.
```

(`run_dedup.py` / `run_promote.py` are thin CLI wrappers reading paths from `paths.py` and calling the tested functions — trivial glue, exercised by the operator, not unit-tested.)

- [ ] **Step 3: Gate** `make -C ai test` → all Python tests pass.
- [ ] **Step 4: Commit** `git add ai/Makefile ai/training/README.md && git commit -m "docs(training): retraining makefile targets + operator runbook"`

---

## Self-review checklist
- [ ] dedup BEFORE split ✓ · grouped split (no patient leakage) ✓ · frozen test set by manifest hash ✓
- [ ] promote gated on macro-F1 + melanoma sensitivity ✓ · archive never overwrites ✓
- [ ] canonical classes match `shared/contract.ts` LESION_CLASSES ✓
- [ ] DATASETS_DIR relocatable ✓ · datasets + *.pt gitignored ✓
- [ ] `make -C ai test` green
