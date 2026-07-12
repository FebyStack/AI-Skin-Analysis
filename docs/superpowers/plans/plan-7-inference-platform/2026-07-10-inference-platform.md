> **SUPERSEDED (v3.1, 2026-07-10):** the FastAPI *runtime* inference service and the untrained dev model in this plan are superseded — backend does NO runtime inference; the future lesion module runs ONNX in the browser via ModelManager (see face-analysis spec D6/D7), and dev/test paths use MockClassifier instead of dummy weights. The dataset/training toolkit parts (Plan 8) remain valid as-is.
# Inference Platform Implementation Plan (Plan 7)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Spec: `docs/superpowers/specs/2026-07-10-ai-classifier-architecture.md`.

**Goal:** Python FastAPI inference service (EfficientNet-B0) + Node backend wiring so close-up scans classify locally and Gemini only explains the JSON — with offline fallback.

**Architecture:** `ai/service` (FastAPI, PyTorch, quality via OpenCV, preprocessing shared with training) is called by the Node backend through a `ClassifierProvider` seam. Scans are saved *before* explanation. Explanations come from Gemini when online (guardrailed) or built-in per-class content when offline; a `ConnectivityMonitor` decides which.

**Tech Stack:** Python 3.12, PyTorch/torchvision, Albumentations, OpenCV, FastAPI, pytest · TypeScript/Express, vitest.

**Conventions:** Python venv at `.venv` (exists, has torch). Run all Python from repo root (`ai/` is a package). Node code: relative imports inside backend/ai, `@shared` only in frontend. Commit after every task.

---

### Task 1: Python package scaffolding + requirements

**Files:**
- Create: `ai/__init__.py`, `ai/service/__init__.py`, `ai/training/__init__.py`, `ai/service/tests/__init__.py`
- Create: `ai/requirements.txt`
- Create: `ai/Makefile`

- [ ] **Step 1: Write files**

`ai/requirements.txt`:
```
torch>=2.4
torchvision>=0.19
albumentations>=1.4
opencv-python-headless>=4.10
pillow>=10
fastapi>=0.115
uvicorn>=0.30
pydantic>=2.8
imagehash>=4.3
pandas>=2.2
scikit-learn>=1.5
pytest>=8
httpx>=0.27
```

`ai/Makefile`:
```makefile
.PHONY: install test serve dev-model
PY = ../.venv/bin/python

install:
	../.venv/bin/pip install -r requirements.txt

test:
	cd .. && .venv/bin/python -m pytest ai -q

serve:
	cd .. && .venv/bin/python -m uvicorn ai.service.main:app --port 8000

dev-model:
	cd .. && .venv/bin/python -m ai.training.make_dev_model
```

All four `__init__.py` files: empty.

- [ ] **Step 2: Install + sanity check**

Run: `cd "/Users/febrielotud/Desktop/Skin analysis" && .venv/bin/pip install -r ai/requirements.txt && .venv/bin/python -c "import torch, cv2, albumentations, fastapi; print('deps-ok')"`
Expected: `deps-ok`

- [ ] **Step 3: Commit**
```bash
git add ai/__init__.py ai/service ai/training/__init__.py ai/requirements.txt ai/Makefile
git commit -m "feat(ai): python package scaffolding + requirements"
```

---

### Task 2: Shared transforms (train/serve parity source)

**Files:**
- Create: `ai/training/transforms.py`
- Test: `ai/service/tests/test_transforms.py`

- [ ] **Step 1: Write the failing test**

```python
# ai/service/tests/test_transforms.py
import numpy as np
from ai.training.transforms import serve_transforms, IMG_SIZE

def test_serve_transform_shape_and_norm():
    rgb = np.full((300, 400, 3), 128, dtype=np.uint8)
    out = serve_transforms()(image=rgb)["image"]
    assert tuple(out.shape) == (3, IMG_SIZE, IMG_SIZE)
    # imagenet-normalized mid-gray must be near zero, not 128
    assert abs(float(out.mean())) < 1.0

def test_serve_transform_deterministic():
    rgb = np.random.default_rng(7).integers(0, 255, (256, 256, 3), dtype=np.uint8)
    a = serve_transforms()(image=rgb)["image"]
    b = serve_transforms()(image=rgb)["image"]
    assert bool((a == b).all())
```

- [ ] **Step 2: Run to verify it fails**

Run: `.venv/bin/python -m pytest ai/service/tests/test_transforms.py -q`
Expected: FAIL (`ModuleNotFoundError: ai.training.transforms`)

- [ ] **Step 3: Implement**

```python
# ai/training/transforms.py
"""SINGLE source of preprocessing. Training and serving both import from here —
never duplicate these transforms (train/serve skew is the failure mode this kills)."""
import albumentations as A
from albumentations.pytorch import ToTensorV2

IMG_SIZE = 224
NORM = dict(mean=(0.485, 0.456, 0.406), std=(0.229, 0.224, 0.225))

def serve_transforms() -> A.Compose:
    return A.Compose([
        A.Resize(IMG_SIZE, IMG_SIZE),
        A.Normalize(**NORM),
        ToTensorV2(),
    ])

def train_transforms() -> A.Compose:
    return A.Compose([
        A.RandomResizedCrop(size=(IMG_SIZE, IMG_SIZE), scale=(0.7, 1.0)),
        A.HorizontalFlip(p=0.5),
        A.VerticalFlip(p=0.5),
        A.ColorJitter(brightness=0.2, contrast=0.2, saturation=0.1, hue=0.02, p=0.5),
        A.Normalize(**NORM),
        ToTensorV2(),
    ])
```

- [ ] **Step 4: Run to verify pass** — same command, expected: 2 passed.
- [ ] **Step 5: Commit** — `git add ai/training/transforms.py ai/service/tests/test_transforms.py && git commit -m "feat(ai): shared train/serve transforms with parity tests"`

---

### Task 3: Quality assessment (OpenCV)

**Files:**
- Create: `ai/service/quality.py`
- Test: `ai/service/tests/test_quality.py`

- [ ] **Step 1: Write the failing test**

```python
# ai/service/tests/test_quality.py
import numpy as np
from ai.service.quality import assess

def _noise(h=400, w=400, lum=128):
    rng = np.random.default_rng(0)
    img = rng.integers(0, 255, (h, w, 3), dtype=np.uint8)
    return (img * 0 + lum + (img % 40) - 20).clip(0, 255).astype(np.uint8)

def test_good_image_passes():
    ok, issues = assess(_noise())
    assert ok and issues == []

def test_tiny_image_flags_resolution():
    ok, issues = assess(_noise(h=100, w=100))
    assert not ok and "low-resolution" in issues

def test_flat_dark_image_flags():
    dark = np.full((400, 400, 3), 8, dtype=np.uint8)
    ok, issues = assess(dark)
    assert not ok and "too-dark" in issues and "blur" in issues
```

- [ ] **Step 2: Run to verify it fails** — `.venv/bin/python -m pytest ai/service/tests/test_quality.py -q` → FAIL (module missing)

- [ ] **Step 3: Implement**

```python
# ai/service/quality.py
import cv2
import numpy as np

MIN_EDGE_PX = 224
BLUR_MIN_LAPLACIAN_VAR = 60.0
BRIGHTNESS_MIN = 0.12
BRIGHTNESS_MAX = 0.92

def assess(bgr: np.ndarray) -> tuple[bool, list[str]]:
    """Hard server-side quality gate. Returns (ok, issues)."""
    issues: list[str] = []
    h, w = bgr.shape[:2]
    if min(h, w) < MIN_EDGE_PX:
        issues.append("low-resolution")
    gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
    if cv2.Laplacian(gray, cv2.CV_64F).var() < BLUR_MIN_LAPLACIAN_VAR:
        issues.append("blur")
    mean = float(gray.mean()) / 255.0
    if mean < BRIGHTNESS_MIN:
        issues.append("too-dark")
    elif mean > BRIGHTNESS_MAX:
        issues.append("too-bright")
    return (len(issues) == 0, issues)
```

- [ ] **Step 4: Run to verify pass** — 3 passed. (If the noise image trips `blur`, raise its contrast in `_noise` rather than lowering the threshold.)
- [ ] **Step 5: Commit** — `git commit -am "feat(ai): opencv quality gate (resolution/blur/exposure)"`

---

### Task 4: Schemas + dev model generator

**Files:**
- Create: `ai/service/schemas.py`
- Create: `ai/training/make_dev_model.py`
- Test: `ai/service/tests/test_schemas.py`

- [ ] **Step 1: Write the failing test**

```python
# ai/service/tests/test_schemas.py
import pytest
from pydantic import ValidationError
from ai.service.schemas import ClassificationResult, TopPrediction, Quality, ModelInfo

def _result(conf=0.9):
    return ClassificationResult(
        prediction="Melanoma", confidence=conf,
        topPredictions=[TopPrediction(label="Melanoma", confidence=conf)],
        abstain=False, quality=Quality(ok=True, issues=[]),
        model=ModelInfo(name="efficientnet-b0", version="0.0.0-dev"),
    )

def test_valid_result_roundtrips():
    assert _result().model_dump()["prediction"] == "Melanoma"

def test_confidence_bounds_enforced():
    with pytest.raises(ValidationError):
        _result(conf=1.5)
```

- [ ] **Step 2: Run to verify it fails** — `.venv/bin/python -m pytest ai/service/tests/test_schemas.py -q` → FAIL

- [ ] **Step 3: Implement**

```python
# ai/service/schemas.py
"""Pydantic mirror of shared/contract.ts ClassificationResult — keep field names identical."""
from pydantic import BaseModel, Field

class TopPrediction(BaseModel):
    label: str
    confidence: float = Field(ge=0, le=1)

class Quality(BaseModel):
    ok: bool
    issues: list[str]

class ModelInfo(BaseModel):
    name: str
    version: str

class ClassificationResult(BaseModel):
    prediction: str
    confidence: float = Field(ge=0, le=1)
    topPredictions: list[TopPrediction]
    abstain: bool
    quality: Quality
    model: ModelInfo
```

```python
# ai/training/make_dev_model.py
"""Create an UNTRAINED EfficientNet-B0 so the service runs before Plan 8 trains a real one.
Predictions are meaningless — version string makes that loud."""
import json
from pathlib import Path
import torch
from torchvision.models import efficientnet_b0

CLASSES = [
    "Melanoma", "Nevus", "Basal Cell Carcinoma", "Actinic Keratosis",
    "Benign Keratosis", "Dermatofibroma", "Vascular Lesion", "Squamous Cell Carcinoma",
]

def main(out_dir: Path = Path("ai/models/production")) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    net = efficientnet_b0(num_classes=len(CLASSES))
    torch.save(net.state_dict(), out_dir / "current.pt")
    (out_dir / "model.json").write_text(json.dumps({
        "name": "efficientnet-b0",
        "version": "0.0.0-dev-untrained",
        "classes": CLASSES,
        "img_size": 224,
        "metrics": None,
        "dataset_manifest_sha256": None,
    }, indent=2))
    print(f"dev model written to {out_dir}")

if __name__ == "__main__":
    main()
```

- [ ] **Step 4: Run tests + generate model**

Run: `.venv/bin/python -m pytest ai/service/tests/test_schemas.py -q && .venv/bin/python -m ai.training.make_dev_model`
Expected: 2 passed; `dev model written to ai/models/production` (files: `current.pt` ~16MB, `model.json`). Both are gitignored by `*.pt`? — **add to `.gitignore`:** `ai/models/**/*.pt` (keep `model.json` trackable but do NOT commit the dev one).

- [ ] **Step 5: Commit** — `git add ai/service/schemas.py ai/training/make_dev_model.py ai/service/tests/test_schemas.py .gitignore && git commit -m "feat(ai): result schema + dev model generator"`

---

### Task 5: Classifier (registry load, predict, abstain policy)

**Files:**
- Create: `ai/service/classifier.py`
- Test: `ai/service/tests/test_classifier.py`

- [ ] **Step 1: Write the failing test**

```python
# ai/service/tests/test_classifier.py
import numpy as np
import pytest
from ai.service.classifier import Classifier, CONF_ABSTAIN
from ai.service.schemas import Quality

@pytest.fixture(scope="module")
def clf():
    return Classifier.load("ai/models/production")  # dev model from Task 4

def _img():
    return np.random.default_rng(1).integers(0, 255, (300, 300, 3), dtype=np.uint8)

def test_predict_shape(clf):
    r = clf.predict(_img(), Quality(ok=True, issues=[]))
    assert len(r.topPredictions) == 3
    assert r.prediction == r.topPredictions[0].label
    assert r.model.name == "efficientnet-b0"

def test_bad_quality_forces_abstain(clf):
    r = clf.predict(_img(), Quality(ok=False, issues=["blur"]))
    assert r.abstain is True

def test_low_confidence_abstains(clf):
    # untrained net ≈ uniform probs → confidence ~1/8 < CONF_ABSTAIN
    r = clf.predict(_img(), Quality(ok=True, issues=[]))
    assert r.confidence < CONF_ABSTAIN and r.abstain is True
```

- [ ] **Step 2: Run to verify it fails** — FAIL (module missing)

- [ ] **Step 3: Implement**

```python
# ai/service/classifier.py
import json
from pathlib import Path
import numpy as np
import torch
from torchvision.models import efficientnet_b0
from ai.training.transforms import serve_transforms
from ai.service.schemas import ClassificationResult, TopPrediction, Quality, ModelInfo

CONF_ABSTAIN = 0.55
ENTROPY_ABSTAIN = 1.9  # nats over 8 classes (uniform = ln 8 ≈ 2.08)

_ARCHS = {"efficientnet-b0": efficientnet_b0}  # future: b3 / convnext / vit → add loaders here

class Classifier:
    def __init__(self, net: torch.nn.Module, classes: list[str], info: ModelInfo):
        self.net, self.classes, self.info = net.eval(), classes, info
        self.tf = serve_transforms()

    @classmethod
    def load(cls, model_dir: str | Path) -> "Classifier":
        model_dir = Path(model_dir)
        meta = json.loads((model_dir / "model.json").read_text())
        arch = _ARCHS[meta["name"]]
        net = arch(num_classes=len(meta["classes"]))
        # weights_only=True: refuse pickled code — a swapped/tampered .pt must not execute anything
        net.load_state_dict(torch.load(model_dir / "current.pt", map_location="cpu", weights_only=True))
        return cls(net, meta["classes"], ModelInfo(name=meta["name"], version=meta["version"]))

    @torch.no_grad()
    def predict(self, rgb: np.ndarray, quality: Quality) -> ClassificationResult:
        x = self.tf(image=rgb)["image"].unsqueeze(0)
        probs = torch.softmax(self.net(x), dim=1)[0].numpy()
        order = np.argsort(probs)[::-1]
        top = [TopPrediction(label=self.classes[i], confidence=float(probs[i])) for i in order[:3]]
        entropy = float(-(probs * np.log(probs + 1e-12)).sum())
        abstain = (not quality.ok) or top[0].confidence < CONF_ABSTAIN or entropy > ENTROPY_ABSTAIN
        return ClassificationResult(
            prediction=top[0].label, confidence=top[0].confidence, topPredictions=top,
            abstain=abstain, quality=quality, model=self.info,
        )
```

- [ ] **Step 4: Run to verify pass** — 3 passed.
- [ ] **Step 5: Commit** — `git commit -am "feat(ai): classifier with registry load + abstain policy"`

---

### Task 6: FastAPI app

**Files:**
- Create: `ai/service/main.py`
- Test: `ai/service/tests/test_api.py`

- [ ] **Step 1: Write the failing test**

```python
# ai/service/tests/test_api.py
import base64
import cv2
import numpy as np
from fastapi.testclient import TestClient
from ai.service.main import app

client = TestClient(app)

def _b64_jpeg(h=400, w=400):
    rng = np.random.default_rng(2)
    img = rng.integers(60, 200, (h, w, 3), dtype=np.uint8)
    ok, buf = cv2.imencode(".jpg", img)
    assert ok
    return base64.b64encode(buf.tobytes()).decode()

def test_healthz():
    r = client.get("/healthz")
    assert r.status_code == 200 and r.json()["ok"] is True

def test_classify_returns_contract_shape():
    r = client.post("/v1/classify", json={"image": _b64_jpeg(), "mime": "image/jpeg"})
    assert r.status_code == 200
    body = r.json()
    assert {"prediction", "confidence", "topPredictions", "abstain", "quality", "model"} <= body.keys()

def test_undecodable_image_400():
    r = client.post("/v1/classify", json={"image": base64.b64encode(b"nope").decode(), "mime": "image/jpeg"})
    assert r.status_code == 400
```

- [ ] **Step 2: Run to verify it fails** — FAIL

- [ ] **Step 3: Implement**

```python
# ai/service/main.py
import base64
import binascii
import os
from functools import lru_cache
import cv2
import numpy as np
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from ai.service.classifier import Classifier
from ai.service.quality import assess
from ai.service.schemas import ClassificationResult, Quality

app = FastAPI(title="skin-inference")

@lru_cache(maxsize=1)
def get_classifier() -> Classifier:
    return Classifier.load(os.environ.get("MODEL_DIR", "ai/models/production"))

class ClassifyRequest(BaseModel):
    image: str  # base64
    mime: str

@app.get("/healthz")
def healthz():
    return {"ok": True, "model": get_classifier().info.model_dump()}

@app.post("/v1/classify", response_model=ClassificationResult)
def classify(req: ClassifyRequest) -> ClassificationResult:
    try:
        raw = base64.b64decode(req.image, validate=True)
    except binascii.Error:
        raise HTTPException(400, "invalid base64")
    bgr = cv2.imdecode(np.frombuffer(raw, np.uint8), cv2.IMREAD_COLOR)
    if bgr is None:
        raise HTTPException(400, "undecodable image")
    ok, issues = assess(bgr)
    rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
    return get_classifier().predict(rgb, Quality(ok=ok, issues=issues))
```

- [ ] **Step 4: Run to verify pass** — `.venv/bin/python -m pytest ai -q` → all Python tests pass.
- [ ] **Step 5: Live smoke** — `make -C ai serve` in background; `curl -s localhost:8000/healthz` → `{"ok":true,...}`. Stop it.
- [ ] **Step 6: Commit** — `git commit -am "feat(ai): fastapi inference service (/healthz, /v1/classify)"`

---

### Task 7: Wire contract — ClassificationResult + LesionExplanation (TypeScript)

**Files:**
- Modify: `shared/contract.ts` (append)
- Create: `ai/evaluation/fixtures/golden-classification.json`
- Test: `shared/lesion-contract.test.ts`

- [ ] **Step 1: Write the golden fixture**

```json
{
  "prediction": "Melanoma",
  "confidence": 0.93,
  "topPredictions": [
    { "label": "Melanoma", "confidence": 0.93 },
    { "label": "Nevus", "confidence": 0.05 },
    { "label": "Basal Cell Carcinoma", "confidence": 0.02 }
  ],
  "abstain": false,
  "quality": { "ok": true, "issues": [] },
  "model": { "name": "efficientnet-b0", "version": "1.0.0" }
}
```

- [ ] **Step 2: Write the failing test**

```typescript
// shared/lesion-contract.test.ts
import { describe, it, expect } from "vitest";
import golden from "../ai/evaluation/fixtures/golden-classification.json";
import { validateClassificationResult, validateLesionExplanation, MALIGNANT_CLASSES } from "./contract";

describe("validateClassificationResult", () => {
  it("accepts the golden classification", () => {
    const r = validateClassificationResult(golden);
    expect(r.ok).toBe(true);
  });
  it("rejects out-of-range confidence", () => {
    expect(validateClassificationResult({ ...golden, confidence: 1.2 }).ok).toBe(false);
  });
  it("rejects missing topPredictions", () => {
    const { topPredictions: _t, ...rest } = golden as Record<string, unknown>;
    expect(validateClassificationResult(rest).ok).toBe(false);
  });
});

describe("validateLesionExplanation", () => {
  const exp = {
    patientSummary: "s", education: "e",
    referral: { recommended: true, urgency: "soon", reason: "r" },
    disclaimer: "Not a diagnosis.", promptVersion: 1, source: "gemini",
  };
  it("accepts a valid explanation", () => {
    expect(validateLesionExplanation(exp).ok).toBe(true);
  });
  it("rejects a missing disclaimer", () => {
    expect(validateLesionExplanation({ ...exp, disclaimer: "" }).ok).toBe(false);
  });
});

it("malignant class list is the safety-critical trio", () => {
  expect(MALIGNANT_CLASSES).toEqual(["Melanoma", "Basal Cell Carcinoma", "Squamous Cell Carcinoma"]);
});
```

- [ ] **Step 3: Run to verify it fails** — `npx vitest run shared/lesion-contract.test.ts` → FAIL (exports missing)

- [ ] **Step 4: Implement (append to `shared/contract.ts`)**

```typescript
// ---------- Lesion classification (close-up mode, Plan 7+) ----------

export const LESION_CLASSES = [
  "Melanoma", "Nevus", "Basal Cell Carcinoma", "Actinic Keratosis",
  "Benign Keratosis", "Dermatofibroma", "Vascular Lesion", "Squamous Cell Carcinoma",
] as const;
export const MALIGNANT_CLASSES = ["Melanoma", "Basal Cell Carcinoma", "Squamous Cell Carcinoma"] as const;

export interface TopPrediction { label: string; confidence: number }
export interface ClassificationResult {
  prediction: string;
  confidence: number;
  topPredictions: TopPrediction[];
  abstain: boolean;
  quality: { ok: boolean; issues: string[] };
  model: { name: string; version: string };
}

export type ReferralUrgency = "routine" | "soon" | "urgent";
export interface LesionExplanation {
  patientSummary: string;
  education: string;
  referral: { recommended: boolean; urgency: ReferralUrgency; reason: string };
  doctorSummary?: string;
  disclaimer: string;
  promptVersion: number;
  source: "gemini" | "builtin";
}

export interface LesionScanReport {
  kind: "lesion";
  classification: ClassificationResult;
  explanation: LesionExplanation;
}

function inRange01(n: unknown): n is number {
  return typeof n === "number" && n >= 0 && n <= 1 && !Number.isNaN(n);
}

export function validateClassificationResult(x: unknown):
  | { ok: true; result: ClassificationResult } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (typeof x !== "object" || x === null) return { ok: false, errors: ["not an object"] };
  const r = x as Record<string, unknown>;
  if (typeof r.prediction !== "string" || r.prediction.length === 0) errors.push("prediction missing");
  if (!inRange01(r.confidence)) errors.push("confidence out of range");
  if (!Array.isArray(r.topPredictions) || r.topPredictions.length === 0 ||
      !r.topPredictions.every((t) => typeof (t as TopPrediction)?.label === "string" && inRange01((t as TopPrediction)?.confidence)))
    errors.push("topPredictions malformed");
  if (typeof r.abstain !== "boolean") errors.push("abstain missing");
  const q = r.quality as Record<string, unknown> | undefined;
  if (typeof q?.ok !== "boolean" || !Array.isArray(q?.issues)) errors.push("quality malformed");
  const m = r.model as Record<string, unknown> | undefined;
  if (typeof m?.name !== "string" || typeof m?.version !== "string") errors.push("model malformed");
  return errors.length === 0 ? { ok: true, result: x as ClassificationResult } : { ok: false, errors };
}

const URGENCIES: readonly string[] = ["routine", "soon", "urgent"];

export function validateLesionExplanation(x: unknown):
  | { ok: true; explanation: LesionExplanation } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (typeof x !== "object" || x === null) return { ok: false, errors: ["not an object"] };
  const e = x as Record<string, unknown>;
  if (typeof e.patientSummary !== "string" || e.patientSummary.length === 0) errors.push("patientSummary missing");
  if (typeof e.education !== "string" || e.education.length === 0) errors.push("education missing");
  const ref = e.referral as Record<string, unknown> | undefined;
  if (typeof ref?.recommended !== "boolean" || !URGENCIES.includes(ref?.urgency as string) || typeof ref?.reason !== "string")
    errors.push("referral malformed");
  if (typeof e.disclaimer !== "string" || e.disclaimer.length === 0) errors.push("disclaimer missing");
  if (typeof e.promptVersion !== "number") errors.push("promptVersion missing");
  if (e.source !== "gemini" && e.source !== "builtin") errors.push("source malformed");
  if (e.doctorSummary !== undefined && typeof e.doctorSummary !== "string") errors.push("doctorSummary malformed");
  return errors.length === 0 ? { ok: true, explanation: x as LesionExplanation } : { ok: false, errors };
}
```

- [ ] **Step 5: Run to verify pass** — `npx vitest run shared/lesion-contract.test.ts` → all pass. Also `npm run typecheck && npm run typecheck:server`.
- [ ] **Step 6: Commit** — `git add shared/contract.ts shared/lesion-contract.test.ts ai/evaluation/fixtures/golden-classification.json && git commit -m "feat(contract): lesion classification + explanation wire types"`

---

### Task 8: ClassifierProvider (HTTP + Fake) in backend

**Files:**
- Create: `backend/modules/analysis/classifier-client.ts`
- Test: `backend/modules/analysis/classifier-client.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// backend/modules/analysis/classifier-client.test.ts
// @vitest-environment node
import { describe, it, expect } from "vitest";
import golden from "../../../ai/evaluation/fixtures/golden-classification.json";
import { HttpClassifierProvider, FakeClassifierProvider, ClassifierUnavailableError } from "./classifier-client";

describe("FakeClassifierProvider", () => {
  it("returns the golden result", async () => {
    const r = await new FakeClassifierProvider().classify("aGk=", "image/jpeg");
    expect(r.prediction).toBe("Melanoma");
    expect(r.model.name).toBe("efficientnet-b0");
  });
});

describe("HttpClassifierProvider", () => {
  it("classifies via fetch and validates the payload", async () => {
    const fetchFn = async () => new Response(JSON.stringify(golden), { status: 200 });
    const p = new HttpClassifierProvider("http://x", 1000, fetchFn as typeof fetch);
    const r = await p.classify("aGk=", "image/jpeg");
    expect(r.confidence).toBeCloseTo(0.93);
  });
  it("throws ClassifierUnavailableError on non-200", async () => {
    const fetchFn = async () => new Response("boom", { status: 503 });
    const p = new HttpClassifierProvider("http://x", 1000, fetchFn as typeof fetch);
    await expect(p.classify("aGk=", "image/jpeg")).rejects.toBeInstanceOf(ClassifierUnavailableError);
  });
  it("throws ClassifierUnavailableError on malformed payload", async () => {
    const fetchFn = async () => new Response(JSON.stringify({ nope: 1 }), { status: 200 });
    const p = new HttpClassifierProvider("http://x", 1000, fetchFn as typeof fetch);
    await expect(p.classify("aGk=", "image/jpeg")).rejects.toBeInstanceOf(ClassifierUnavailableError);
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `npx vitest run backend/modules/analysis/classifier-client.test.ts` → FAIL

- [ ] **Step 3: Implement**

```typescript
// backend/modules/analysis/classifier-client.ts
import { validateClassificationResult, type ClassificationResult } from "../../../shared/contract";
import golden from "../../../ai/evaluation/fixtures/golden-classification.json";

export class ClassifierUnavailableError extends Error {
  constructor(detail: string) {
    super(`Classifier unavailable: ${detail}`);
    this.name = "ClassifierUnavailableError";
  }
}

export interface ClassifierProvider {
  classify(imageB64: string, mime: string): Promise<ClassificationResult>;
}

export class HttpClassifierProvider implements ClassifierProvider {
  constructor(
    private baseUrl: string,
    private timeoutMs = 20_000,
    private fetchFn: typeof fetch = fetch,
  ) {}

  async classify(imageB64: string, mime: string): Promise<ClassificationResult> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
    try {
      const res = await this.fetchFn(`${this.baseUrl}/v1/classify`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ image: imageB64, mime }),
        signal: ctrl.signal,
      });
      if (!res.ok) throw new ClassifierUnavailableError(`status ${res.status}`);
      const parsed = validateClassificationResult(await res.json());
      if (!parsed.ok) throw new ClassifierUnavailableError(`malformed result: ${parsed.errors.join("; ")}`);
      return parsed.result;
    } catch (err) {
      if (err instanceof ClassifierUnavailableError) throw err;
      throw new ClassifierUnavailableError(err instanceof Error ? err.message : String(err));
    } finally {
      clearTimeout(timer);
    }
  }
}

// Dev/test provider: full app with zero Python running (FAKE_CLASSIFIER=1).
export class FakeClassifierProvider implements ClassifierProvider {
  async classify(): Promise<ClassificationResult> {
    return structuredClone(golden) as ClassificationResult;
  }
}
```

- [ ] **Step 4: Run to verify pass**, then **Step 5: Commit** — `git commit -am "feat(backend): ClassifierProvider seam (http + fake)"`

---

### Task 9: ConnectivityMonitor

**Files:**
- Create: `backend/shared/connectivity.ts`
- Test: `backend/shared/connectivity.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// backend/shared/connectivity.test.ts
// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import { ConnectivityMonitor } from "./connectivity";

describe("ConnectivityMonitor", () => {
  it("starts online", () => {
    expect(new ConnectivityMonitor(async () => true).isOnline()).toBe(true);
  });
  it("check() flips state based on probe", async () => {
    let up = false;
    const m = new ConnectivityMonitor(async () => up, 50);
    expect(await m.check()).toBe(false);
    expect(m.isOnline()).toBe(false);
    up = true;
    expect(await m.check()).toBe(true);
    expect(m.isOnline()).toBe(true);
  });
  it("markOffline schedules re-probes until online again", async () => {
    vi.useFakeTimers();
    let up = false;
    const m = new ConnectivityMonitor(async () => up, 100);
    m.markOffline();
    expect(m.isOnline()).toBe(false);
    await vi.advanceTimersByTimeAsync(150);   // probe fails, reschedules
    expect(m.isOnline()).toBe(false);
    up = true;
    await vi.advanceTimersByTimeAsync(150);   // probe succeeds
    expect(m.isOnline()).toBe(true);
    vi.useRealTimers();
  });
});
```

- [ ] **Step 2: Run to verify it fails** — FAIL

- [ ] **Step 3: Implement**

```typescript
// backend/shared/connectivity.ts
export type ConnectivityProbe = () => Promise<boolean>;

// Server-side truth for "can we reach the LLM" — navigator.onLine lies behind captive portals.
export class ConnectivityMonitor {
  private online = true;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private probe: ConnectivityProbe, private intervalMs = 30_000) {}

  isOnline(): boolean {
    return this.online;
  }

  markOnline(): void {
    this.online = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  markOffline(): void {
    if (!this.online) return;
    this.online = false;
    this.schedule();
  }

  async check(): Promise<boolean> {
    const ok = await this.probe().catch(() => false);
    ok ? this.markOnline() : this.markOffline();
    return ok;
  }

  private schedule(): void {
    this.timer = setTimeout(async () => {
      this.timer = null;
      const ok = await this.probe().catch(() => false);
      if (ok) this.markOnline();
      else this.schedule();
    }, this.intervalMs);
    (this.timer as { unref?: () => void }).unref?.();
  }
}
```

- [ ] **Step 4: Run to verify pass**, then **Step 5: Commit** — `git commit -am "feat(backend): connectivity monitor (probe + offline re-probe loop)"`

---

### Task 10: Built-in offline explanations

**Files:**
- Create: `ai/llm/fallback/lesion-education.ts`
- Test: `ai/llm/fallback/lesion-education.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// ai/llm/fallback/lesion-education.test.ts
import { describe, it, expect } from "vitest";
import golden from "../../evaluation/fixtures/golden-classification.json";
import type { ClassificationResult } from "../../../shared/contract";
import { builtinExplanation, BUILTIN_CONTENT_VERSION } from "./lesion-education";

const g = golden as ClassificationResult;

describe("builtinExplanation", () => {
  it("malignant prediction always recommends referral", () => {
    const e = builtinExplanation(g); // golden = Melanoma
    expect(e.referral.recommended).toBe(true);
    expect(e.referral.urgency).toBe("urgent");
    expect(e.source).toBe("builtin");
    expect(e.disclaimer.length).toBeGreaterThan(10);
  });
  it("abstain produces inconclusive guidance with referral", () => {
    const e = builtinExplanation({ ...g, abstain: true });
    expect(e.patientSummary).toMatch(/inconclusive/i);
    expect(e.referral.recommended).toBe(true);
  });
  it("benign class still educates and never claims certainty", () => {
    const e = builtinExplanation({ ...g, prediction: "Nevus", topPredictions: [{ label: "Nevus", confidence: 0.9 }] });
    expect(e.education.length).toBeGreaterThan(20);
    expect(e.patientSummary).not.toMatch(/\b(definitely|certainly|is cancer)\b/i);
  });
  it("every lesion class has authored content", () => {
    for (const label of ["Melanoma", "Nevus", "Basal Cell Carcinoma", "Actinic Keratosis", "Benign Keratosis", "Dermatofibroma", "Vascular Lesion", "Squamous Cell Carcinoma"]) {
      const e = builtinExplanation({ ...g, prediction: label, abstain: false, topPredictions: [{ label, confidence: 0.8 }] });
      expect(e.education.length, label).toBeGreaterThan(20);
    }
  });
  it("content is versioned", () => {
    expect(BUILTIN_CONTENT_VERSION).toBeGreaterThanOrEqual(1);
  });
});
```

- [ ] **Step 2: Run to verify it fails** — FAIL

- [ ] **Step 3: Implement**

```typescript
// ai/llm/fallback/lesion-education.ts
// Pre-authored offline educational content. Reviewed once (doctor sign-off recommended),
// versioned like prompts. Language rules: suggestive framing only, no certainty, no treatment.
import type { ClassificationResult, LesionExplanation, ReferralUrgency } from "../../../shared/contract";
import { MALIGNANT_CLASSES } from "../../../shared/contract";

export const BUILTIN_CONTENT_VERSION = 1;

export const DISCLAIMER =
  "This is not a diagnosis. The analysis is an automated visual assessment and can be wrong. " +
  "Only a qualified professional examining you in person can diagnose a skin condition.";

interface ClassContent { summary: string; education: string; urgency: ReferralUrgency }

const CONTENT: Record<string, ClassContent> = {
  "Melanoma": {
    summary: "The analysis suggests features that can be associated with melanoma, a serious form of skin cancer. This finding needs prompt professional evaluation.",
    education: "Melanoma is a skin cancer arising from pigment cells. Warning signs include asymmetry, irregular borders, multiple colours, diameter growth, and change over time (the ABCDE rule). Early professional assessment matters greatly for outcomes.",
    urgency: "urgent",
  },
  "Squamous Cell Carcinoma": {
    summary: "The analysis suggests features that can be associated with squamous cell carcinoma, a common skin cancer. A professional should assess this soon.",
    education: "Squamous cell carcinoma often appears as a firm, scaly, or crusted bump, sometimes tender, frequently on sun-exposed skin. It is usually treatable, especially when assessed early.",
    urgency: "urgent",
  },
  "Basal Cell Carcinoma": {
    summary: "The analysis suggests features that can be associated with basal cell carcinoma, the most common and typically slow-growing skin cancer. Professional assessment is recommended.",
    education: "Basal cell carcinoma often looks like a pearly bump, a flat scar-like patch, or a sore that heals and reopens. It grows slowly and rarely spreads, but should be treated.",
    urgency: "soon",
  },
  "Actinic Keratosis": {
    summary: "The analysis suggests features consistent with actinic keratosis, a sun-damage change that a professional should look at.",
    education: "Actinic keratoses are rough, scaly patches from long-term sun exposure. A small share can progress toward skin cancer over time, which is why they are usually checked and often treated.",
    urgency: "soon",
  },
  "Benign Keratosis": {
    summary: "The analysis suggests features consistent with a benign keratosis, a common non-cancerous skin growth.",
    education: "Seborrheic keratoses and similar benign growths are very common with age — often waxy, 'stuck-on'-looking patches. They are harmless, but any growth that changes, bleeds, or looks unusual deserves a professional look.",
    urgency: "routine",
  },
  "Nevus": {
    summary: "The analysis suggests features consistent with a nevus (a common mole).",
    education: "Moles are clusters of pigment cells and are usually harmless. Keep an eye on change: new asymmetry, border irregularity, colour variation, growth, itching, or bleeding are reasons to see a professional.",
    urgency: "routine",
  },
  "Dermatofibroma": {
    summary: "The analysis suggests features consistent with a dermatofibroma, a common benign skin nodule.",
    education: "Dermatofibromas are small, firm bumps, often on the legs, frequently after a minor injury or insect bite. They are benign and usually need no treatment.",
    urgency: "routine",
  },
  "Vascular Lesion": {
    summary: "The analysis suggests features consistent with a vascular lesion, such as a cherry angioma.",
    education: "Vascular lesions are collections of small blood vessels — commonly bright red or purple spots. Most are harmless; sudden changes or bleeding are reasons to get a professional opinion.",
    urgency: "routine",
  },
};

export function builtinExplanation(result: ClassificationResult): LesionExplanation {
  const malignantSeen = result.topPredictions.some(
    (t) => (MALIGNANT_CLASSES as readonly string[]).includes(t.label) && t.confidence >= 0.15,
  );

  if (result.abstain) {
    return {
      patientSummary:
        "The analysis was inconclusive — the image did not give the model enough confidence to suggest anything specific. This is not reassurance and not a warning; it simply means the automated check cannot help here.",
      education:
        "Automated analysis abstains when image quality is limited or when the pattern does not clearly match what it was trained on. If you are concerned about this spot — especially if it is new, changing, or bleeding — see a professional regardless.",
      referral: { recommended: true, urgency: malignantSeen ? "soon" : "routine", reason: "Inconclusive automated analysis — professional evaluation is the reliable next step." },
      disclaimer: DISCLAIMER,
      promptVersion: BUILTIN_CONTENT_VERSION,
      source: "builtin",
    };
  }

  const c = CONTENT[result.prediction] ?? {
    summary: "The analysis returned a category without authored guidance.",
    education: "Please consult a professional for an in-person assessment of this spot.",
    urgency: "soon" as ReferralUrgency,
  };
  const recommended = malignantSeen || c.urgency !== "routine";
  return {
    patientSummary: c.summary,
    education: c.education,
    referral: {
      recommended,
      urgency: c.urgency,
      reason: recommended
        ? "The suggested category (or a possibility in the top results) warrants an in-person professional check."
        : "No urgent signal from this analysis — mention it at your next routine visit, and sooner if it changes.",
    },
    disclaimer: DISCLAIMER,
    promptVersion: BUILTIN_CONTENT_VERSION,
    source: "builtin",
  };
}
```

- [ ] **Step 4: Run to verify pass**, then **Step 5: Commit** — `git commit -am "feat(ai): built-in offline lesion explanations (versioned, referral-safe)"`

---

### Task 11: Gemini explainer (JSON-in, guardrailed JSON-out)

**Files:**
- Create: `ai/llm/explainer.ts`
- Test: `ai/llm/explainer.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// ai/llm/explainer.test.ts
import { describe, it, expect } from "vitest";
import golden from "../evaluation/fixtures/golden-classification.json";
import type { ClassificationResult } from "../../shared/contract";
import { buildExplainPrompt, checkExplanationGuardrails, explainClassification, EXPLAIN_PROMPT_VERSION } from "./explainer";

const g = golden as ClassificationResult;

const goodExplanation = {
  patientSummary: "The analysis suggests features associated with melanoma; a professional must confirm.",
  education: "Melanoma is a skin cancer arising from pigment cells...",
  referral: { recommended: true, urgency: "urgent", reason: "Possible melanoma features." },
  disclaimer: "This is not a diagnosis.",
  promptVersion: EXPLAIN_PROMPT_VERSION,
  source: "gemini",
};

describe("buildExplainPrompt", () => {
  it("embeds the classification JSON and never asks for an image", () => {
    const p = buildExplainPrompt(g);
    expect(p).toContain('"Melanoma"');
    expect(p).toMatch(/must not.*(diagnos|certain)/is);
  });
});

describe("checkExplanationGuardrails", () => {
  it("passes a compliant explanation", () => {
    expect(checkExplanationGuardrails(goodExplanation as never, g).ok).toBe(true);
  });
  it("rejects certainty language", () => {
    const bad = { ...goodExplanation, patientSummary: "You definitely have melanoma." };
    expect(checkExplanationGuardrails(bad as never, g).ok).toBe(false);
  });
  it("rejects missing referral when a malignant class is in top-3", () => {
    const bad = { ...goodExplanation, referral: { recommended: false, urgency: "routine", reason: "n/a" } };
    expect(checkExplanationGuardrails(bad as never, g).ok).toBe(false);
  });
});

describe("explainClassification", () => {
  it("returns a validated explanation from a good provider", async () => {
    const call = async () => JSON.stringify(goodExplanation);
    const e = await explainClassification(g, call);
    expect(e?.source).toBe("gemini");
  });
  it("retries once, then returns null on persistent garbage", async () => {
    let calls = 0;
    const call = async () => { calls++; return "not json at all"; };
    const e = await explainClassification(g, call);
    expect(e).toBeNull();
    expect(calls).toBe(2);
  });
});
```

- [ ] **Step 2: Run to verify it fails** — FAIL

- [ ] **Step 3: Implement**

```typescript
// ai/llm/explainer.ts
// Gemini receives ONLY the classifier's structured JSON — never the image.
import { extractJson } from "./providers/common";
import {
  validateLesionExplanation,
  MALIGNANT_CLASSES,
  type ClassificationResult,
  type LesionExplanation,
} from "../../shared/contract";

export const EXPLAIN_PROMPT_VERSION = 1;

const CERTAINTY_PATTERNS = /\b(definitely|certainly|without a doubt|you have|it is cancer|confirmed diagnosis)\b/i;
const TREATMENT_PATTERNS = /\b(take|apply|prescri|dosage|mg\b)\b/i;

export function buildExplainPrompt(result: ClassificationResult): string {
  return [
    "You are a careful medical-communication assistant for a skin-analysis tool.",
    "An image classifier (not you) produced this structured result:",
    "```json",
    JSON.stringify(result, null, 2),
    "```",
    "Write a JSON object with exactly these fields:",
    `{"patientSummary": string, "education": string, "referral": {"recommended": boolean, "urgency": "routine"|"soon"|"urgent", "reason": string}, "doctorSummary": string, "disclaimer": string, "promptVersion": ${EXPLAIN_PROMPT_VERSION}, "source": "gemini"}`,
    "Hard rules — you must not violate any:",
    "- You must NOT diagnose, must not claim certainty, and must not override or re-rank the classifier.",
    "- Frame everything as 'the analysis suggests…' with the confidence given; a professional must confirm.",
    "- If any of Melanoma, Basal Cell Carcinoma, or Squamous Cell Carcinoma appears in topPredictions, referral.recommended MUST be true.",
    "- No treatment or medication advice.",
    "- disclaimer must state this is not a diagnosis.",
    "- If abstain is true, explain that the analysis was inconclusive and recommend professional evaluation.",
    "Respond with ONLY the JSON object.",
  ].join("\n");
}

export function checkExplanationGuardrails(
  explanation: LesionExplanation,
  result: ClassificationResult,
): { ok: boolean; violations: string[] } {
  const violations: string[] = [];
  const text = `${explanation.patientSummary} ${explanation.education} ${explanation.doctorSummary ?? ""}`;
  if (CERTAINTY_PATTERNS.test(text)) violations.push("certainty language");
  if (TREATMENT_PATTERNS.test(text)) violations.push("treatment advice");
  if (!/not a diagnosis/i.test(explanation.disclaimer)) violations.push("weak disclaimer");
  const malignantSeen = result.topPredictions.some(
    (t) => (MALIGNANT_CLASSES as readonly string[]).includes(t.label) && t.confidence >= 0.15,
  );
  if ((malignantSeen || result.abstain) && !explanation.referral.recommended)
    violations.push("missing mandatory referral");
  return { ok: violations.length === 0, violations };
}

export async function explainClassification(
  result: ClassificationResult,
  callProvider: (prompt: string) => Promise<string>,
): Promise<LesionExplanation | null> {
  const prompt = buildExplainPrompt(result);
  for (let attempt = 0; attempt < 2; attempt++) {
    const raw = await callProvider(prompt).catch(() => null);
    if (raw === null) continue;
    const parsed = validateLesionExplanation(extractJson(raw));
    if (!parsed.ok) continue;
    const explanation: LesionExplanation = { ...parsed.explanation, source: "gemini", promptVersion: EXPLAIN_PROMPT_VERSION };
    if (checkExplanationGuardrails(explanation, result).ok) return explanation;
  }
  return null; // caller substitutes the builtin explanation
}
```

- [ ] **Step 4: Run to verify pass**, then **Step 5: Commit** — `git commit -am "feat(ai): gemini lesion explainer with guardrails (json-only, image never sent)"`

---

### Task 12: Close-up route — classify → save → explain → update

**Files:**
- Modify: `backend/shared/deps.ts` (add classifier + connectivity + explain deps)
- Modify: `backend/shared/testing.ts`
- Modify: `backend/modules/analysis/routes.ts` (closeup branch + `POST /api/scans/:id/explain`)
- Modify: `backend/app/app.ts` (health includes llm status)
- Test: `backend/app/lesion-flow.test.ts`

- [ ] **Step 1: Extend AppDeps**

```typescript
// backend/shared/deps.ts — add imports and fields
import type { ClassifierProvider } from "../modules/analysis/classifier-client";
import type { ConnectivityMonitor } from "./connectivity";

export interface AppDeps {
  patients: PatientRepo;
  scans: ScanRepo;
  settings: SettingsRepo;
  pipeline: PipelineDeps;                 // face mode (unchanged)
  classifier: ClassifierProvider;         // close-up mode
  connectivity: ConnectivityMonitor;
  explainProvider: (prompt: string) => Promise<string>;   // gemini text call, no image
  sessionSecret: string;
  now: () => number;
}
```

```typescript
// backend/shared/testing.ts — extend makeTestDeps return with:
    classifier: new FakeClassifierProvider(),
    connectivity: new ConnectivityMonitor(async () => true),
    explainProvider: async () =>
      JSON.stringify({
        patientSummary: "The analysis suggests features associated with melanoma; a professional must confirm.",
        education: "Melanoma education text for tests.",
        referral: { recommended: true, urgency: "urgent", reason: "possible melanoma" },
        disclaimer: "This is not a diagnosis.",
        promptVersion: 1,
        source: "gemini",
      }),
// imports: FakeClassifierProvider from "../modules/analysis/classifier-client";
//          ConnectivityMonitor from "./connectivity";
```

- [ ] **Step 2: Write the failing integration test**

```typescript
// backend/app/lesion-flow.test.ts
// @vitest-environment node
import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { createApp } from "./app";
import { makeTestDeps } from "../shared/testing";
import { ConnectivityMonitor } from "../shared/connectivity";
import type { AppDeps } from "../shared/deps";

const PNG_1PX = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

async function login(app: ReturnType<typeof createApp>) {
  const res = await request(app).post("/api/auth/login").send({ password: "testpass123" });
  return res.headers["set-cookie"];
}

describe("close-up lesion flow", () => {
  let deps: AppDeps;
  beforeEach(() => { deps = makeTestDeps(); });

  it("classifies, saves, and attaches a gemini explanation when online", async () => {
    const app = createApp(deps);
    const cookie = await login(app);
    const res = await request(app).post("/api/analyze").set("Cookie", cookie)
      .send({ patientId: "walk-in", image: PNG_1PX, mime: "image/png", mode: "closeup" });
    expect(res.status).toBe(200);
    expect(res.body.scan.report.kind).toBe("lesion");
    expect(res.body.scan.report.classification.prediction).toBe("Melanoma");
    expect(res.body.scan.report.explanation.source).toBe("gemini");
    expect(res.body.scan.partial).toBe(false);
  });

  it("falls back to builtin explanation when offline — prediction survives", async () => {
    deps.connectivity = new ConnectivityMonitor(async () => false);
    deps.connectivity.markOffline();
    const app = createApp(deps);
    const cookie = await login(app);
    const res = await request(app).post("/api/analyze").set("Cookie", cookie)
      .send({ patientId: "walk-in", image: PNG_1PX, mime: "image/png", mode: "closeup" });
    expect(res.status).toBe(200);
    expect(res.body.scan.report.classification.prediction).toBe("Melanoma");
    expect(res.body.scan.report.explanation.source).toBe("builtin");
    expect(res.body.scan.report.explanation.referral.recommended).toBe(true);
  });

  it("gemini failure mid-request degrades to builtin, never loses the prediction", async () => {
    deps.explainProvider = async () => { throw new Error("network died"); };
    const app = createApp(deps);
    const cookie = await login(app);
    const res = await request(app).post("/api/analyze").set("Cookie", cookie)
      .send({ patientId: "walk-in", image: PNG_1PX, mime: "image/png", mode: "closeup" });
    expect(res.status).toBe(200);
    expect(res.body.scan.report.explanation.source).toBe("builtin");
  });

  it("POST /api/scans/:id/explain upgrades a builtin explanation once online", async () => {
    const offline = new ConnectivityMonitor(async () => false);
    offline.markOffline();
    deps.connectivity = offline;
    const app = createApp(deps);
    const cookie = await login(app);
    const analyzed = await request(app).post("/api/analyze").set("Cookie", cookie)
      .send({ patientId: "walk-in", image: PNG_1PX, mime: "image/png", mode: "closeup" });
    expect(analyzed.body.scan.report.explanation.source).toBe("builtin");

    deps.connectivity.markOnline();
    const upgraded = await request(app).post(`/api/scans/${analyzed.body.scan.id}/explain`).set("Cookie", cookie);
    expect(upgraded.status).toBe(200);
    expect(upgraded.body.explanation.source).toBe("gemini");
  });

  it("explain endpoint answers 503 offline", async () => {
    const offline = new ConnectivityMonitor(async () => false);
    offline.markOffline();
    deps.connectivity = offline;
    const app = createApp(deps);
    const cookie = await login(app);
    const analyzed = await request(app).post("/api/analyze").set("Cookie", cookie)
      .send({ patientId: "walk-in", image: PNG_1PX, mime: "image/png", mode: "closeup" });
    const res = await request(app).post(`/api/scans/${analyzed.body.scan.id}/explain`).set("Cookie", cookie);
    expect(res.status).toBe(503);
  });

  it("health reports llm status", async () => {
    const app = createApp(deps);
    const res = await request(app).get("/api/health");
    expect(res.body.llm).toBe("online");
  });
});
```

- [ ] **Step 3: Run to verify it fails** — `npx vitest run backend/app/lesion-flow.test.ts` → FAIL

- [ ] **Step 4: Implement the routes**

In `backend/modules/analysis/routes.ts`, inside `router.post("/api/analyze", …)` replace the single-path body with mode dispatch — face path stays byte-identical, closeup path added; and add the explain route. Additions:

```typescript
import { ClassifierUnavailableError } from "./classifier-client";
import { explainClassification } from "../../../ai/llm/explainer";
import { builtinExplanation } from "../../../ai/llm/fallback/lesion-education";
import type { LesionScanReport } from "../../../shared/contract";

// -- inside the analyze handler, after patient resolution, BEFORE the existing pipeline code:
    if (mode === "closeup") {
      let classification;
      try {
        classification = await deps.classifier.classify(String(image), String(mime));
      } catch (err) {
        if (err instanceof ClassifierUnavailableError) {
          // honest partial: save image, no analysis (mirrors existing partial behavior)
          const compressed = await compressToJpeg(Buffer.from(String(image), "base64"));
          const scan = await deps.scans.create({
            patientId: patient.id, mode, imageJpeg: compressed.jpeg,
            imageWidth: compressed.width, imageHeight: compressed.height,
            report: null, partial: true, classifierFindings: [], promptVersion: null,
          });
          const { imageJpeg: _i, ...scanWire } = scan;
          res.status(200).json({ scan: scanWire, degraded: "classifier-unavailable" });
          return;
        }
        throw err;
      }

      // SAVE FIRST — a Gemini failure can never invalidate the prediction.
      const compressed = await compressToJpeg(Buffer.from(String(image), "base64"));
      let report: LesionScanReport = {
        kind: "lesion", classification, explanation: builtinExplanation(classification),
      };
      const scan = await deps.scans.create({
        patientId: patient.id, mode, imageJpeg: compressed.jpeg,
        imageWidth: compressed.width, imageHeight: compressed.height,
        report: report as never, partial: false, classifierFindings: [],
        promptVersion: report.explanation.promptVersion,
      });

      if (deps.connectivity.isOnline()) {
        const explanation = await explainClassification(classification, deps.explainProvider).catch(() => null);
        if (explanation) {
          report = { ...report, explanation };
          await deps.scans.updateReport(scan.id, report as never, explanation.promptVersion);
        } else {
          deps.connectivity.markOffline(); // real call failed → flip state, re-probe loop takes over
        }
      }
      const { imageJpeg: _img, ...scanWire } = scan;
      res.json({ scan: { ...scanWire, report } });
      return;
    }
// -- existing face-mode code continues unchanged below --

// -- new route, after the reanalyze route:
  router.post("/api/scans/:id/explain", auth, async (req, res) => {
    const scan = await deps.scans.get(req.params.id);
    const report = scan?.report as LesionScanReport | null;
    if (!scan || report?.kind !== "lesion") {
      res.status(404).json({ error: "not found" });
      return;
    }
    if (report.explanation.source === "gemini") {
      res.json({ explanation: report.explanation }); // idempotent
      return;
    }
    if (!deps.connectivity.isOnline()) {
      res.status(503).json({ error: "offline" });
      return;
    }
    const explanation = await explainClassification(report.classification, deps.explainProvider).catch(() => null);
    if (!explanation) {
      deps.connectivity.markOffline();
      res.status(503).json({ error: "offline" });
      return;
    }
    const updated: LesionScanReport = { ...report, explanation };
    await deps.scans.updateReport(scan.id, updated as never, explanation.promptVersion);
    res.json({ explanation });
  });
```

In `backend/app/app.ts`, health becomes:

```typescript
  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, llm: deps.connectivity.isOnline() ? "online" : "offline" });
  });
```

Note: `ScanRepo.updateReport` types `AnalysisReport` — widen its signature in `backend/modules/analysis/repository.ts` and the `ScanRecord.report` field to `AnalysisReport | LesionScanReport` (import the type from shared/contract); Memory + Pg impls need no logic change (JSONB is shape-agnostic).

- [ ] **Step 5: Run to verify pass** — `npx vitest run backend` then the full suite `npx vitest run` (face-mode tests must be untouched: same pass/fail counts as before this plan).
- [ ] **Step 6: Commit** — `git commit -am "feat(backend): close-up lesion flow — classify, save-first, explain online/builtin offline, explain upgrade endpoint"`

---

### Task 13: Entry wiring + compose inference service

**Files:**
- Modify: `backend/server/index.ts`, `backend/server/index-lite.ts`
- Create: `infrastructure/docker/Dockerfile.inference`
- Modify: `infrastructure/docker/docker-compose.yml`

- [ ] **Step 1: Wire real deps in both entries**

```typescript
// backend/server/index.ts (same block in index-lite.ts) — add before createApp:
import { HttpClassifierProvider, FakeClassifierProvider } from "../modules/analysis/classifier-client";
import { ConnectivityMonitor } from "../shared/connectivity";

  const classifier = process.env.FAKE_CLASSIFIER === "1"
    ? new FakeClassifierProvider()
    : new HttpClassifierProvider(process.env.CLASSIFIER_URL ?? "http://localhost:8000");

  const connectivity = new ConnectivityMonitor(async () => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 5000);
    try {
      const res = await fetch("https://generativelanguage.googleapis.com/", { method: "HEAD", signal: ctrl.signal });
      return res.status < 500;
    } catch { return false; } finally { clearTimeout(t); }
  });

  const explainProvider = async (prompt: string) => {
    const result = await callGemini(
      { imageB64: "", mime: "", system: "You are a careful medical-communication assistant.", user: prompt },
      { apiKey, model: process.env.CRITIQUE_MODEL ?? "gemini-2.5-flash", maxTokens: Number(process.env.MAX_TOKENS ?? "2048") },
    );
    return result.text;
  };
  // pass { classifier, connectivity, explainProvider } into createApp deps
```

Note: `callGemini` currently always attaches `inlineData` — make the image part conditional: in `ai/llm/providers/gemini.ts`, build `parts` as `[{ text: req.user }]` and push the `inlineData` part only when `req.imageB64 !== ""`. (Face mode unaffected.)

- [ ] **Step 2: Dockerfile.inference**

```dockerfile
# infrastructure/docker/Dockerfile.inference
FROM python:3.12-slim
WORKDIR /app
COPY ai/requirements.txt ai/requirements.txt
RUN pip install --no-cache-dir --index-url https://download.pytorch.org/whl/cpu torch torchvision \
 && pip install --no-cache-dir -r ai/requirements.txt
COPY ai/__init__.py ai/__init__.py
COPY ai/service ai/service
COPY ai/training/__init__.py ai/training/transforms.py ai/training/
EXPOSE 8000
CMD ["python", "-m", "uvicorn", "ai.service.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

- [ ] **Step 3: compose additions**

```yaml
# infrastructure/docker/docker-compose.yml — add service; api gains env + depends_on
  inference:
    build:
      context: ../..
      dockerfile: infrastructure/docker/Dockerfile.inference
    volumes:
      - ../../ai/models:/app/ai/models:ro
    healthcheck:
      test: ["CMD-SHELL", "python -c \"import urllib.request;urllib.request.urlopen('http://localhost:8000/healthz')\""]
      interval: 10s
      timeout: 5s
      retries: 12

# api service: add to environment:
      CLASSIFIER_URL: http://inference:8000
# api depends_on stays db-only — api starts fine without inference (degrades to partial scans).
```

- [ ] **Step 4: Gates**
- `npm run typecheck && npm run typecheck:server && npx vitest run` — green (same face-mode baseline).
- `FAKE_CLASSIFIER=1 npm run dev:lite` + curl a closeup analyze → lesion report with builtin/gemini explanation.
- `make build` → all three images build.

- [ ] **Step 5: Commit** — `git commit -am "feat(infra): inference container + entry wiring (FAKE_CLASSIFIER dev seam)"`

---

## Self-review checklist (run after Task 13)
- [ ] Spec coverage: pipeline order (save-first) ✓ · abstain policy ✓ (service) · malignant referral ✓ (builtin + guardrails) · offline modes ✓ · connectivity ✓ · JSON-only to Gemini ✓ (conditional inlineData) · model registry ✓ (`_ARCHS` + model.json)
- [ ] Full suite green; face-mode test counts unchanged from pre-plan baseline
- [ ] `grep -rn "imageB64: \"\"" backend ai` — only the explainProvider; no image ever passed to explain calls
