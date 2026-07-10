# AI Architecture — EfficientNet Classifier + Gemini Explainer (v1)

Date: 2026-07-10 · Status: designed, not implemented · Supersedes the AI portion of the v2 spec **for close-up mode only**.

## Locked Spec

1. **Scope: close-up (lesion) mode only.** Face mode keeps the existing 12-dimension Gemini-vision pipeline unchanged.
2. **Inference runtime: Python FastAPI service** in `ai/service/` (PyTorch native). The browser ONNX classifier is **decommissioned** — one inference path.
3. **Datasets on-laptop, relocatable:** `DATASETS_DIR` env, default `ai/datasets/` (gitignored). Moving to an external disk later = change one env var.
4. Stack as specified: EfficientNet-B0 (PyTorch) → upgradeable to B3/ConvNeXt-Tiny/ViT; Gemini explains only; OpenCV + Pillow + Albumentations; ISIC 2019 primary + PAD-UFES-20, Fitzpatrick17k, HAM10000, BCN20000 (deduped); pHash + ID dedup; `models/{production,candidate,archive}`; manual retraining.
5. **Offline-first (added 2026-07-10):** classification NEVER depends on internet; Gemini is the only network dependency. Online = enhanced explanation + persisted; offline = built-in per-class educational explanation; live connectivity monitoring with automatic explanation upgrade on reconnect. Images to Gemini: **never by default** (JSON only); image-upload cloud analysis is a possible future opt-in, off by default.
6. Assumption: "local" = the clinic-laptop stack (browser + backend + inference service on one machine). A phone-standalone offline PWA is out of scope for v1 — if wanted later, it's the `export.py` ONNX path reviving browser inference behind the same wire contract.
7. **Responsive UI (added 2026-07-10):** every view must work on phones (~375px), tablets/iPads (768–1024px), and desktops (1280px+) — Tailwind breakpoints, fluid single-column → multi-column results layout, touch targets ≥ 44px, camera/upload UI usable by touch. Verified at all three widths before completion.

## Pipeline (close-up mode)

```
Browser upload/capture (consent + framing UX only — no on-device inference)
  ↓ POST /api/analyze {mode:"closeup", image}
Node backend · modules/analysis
  ↓ input validation (mime, size, base64)                    [existing guardrails.ts checks]
  ↓ HTTP → Python inference service  POST /v1/classify
      1. quality assessment  (OpenCV: Laplacian blur, exposure, min-resolution)
      2. preprocessing       (Albumentations — SAME transforms module as training)
      3. EfficientNet-B0     (models/production/current.pt)
      4. structured JSON     (schema below; abstain policy applied)
  ↓ ClassificationResult JSON
  ↓ Gemini explainer (ai/llm) — receives JSON ONLY, never the image
  ↓ guardrails + critique on the explanation text
  ↓ save scan (classifier JSON + explanation in report JSONB, + model version)
  ↓ return wire result
Face mode: unchanged (Gemini vision report). Router dispatches on `mode`.
```

## Wire contract (`shared/contract.ts` — the only thing frontend sees)

```ts
interface ClassificationResult {
  prediction: string;            // "Melanoma"
  confidence: number;            // 0..1
  topPredictions: { label: string; confidence: number }[];  // top-3
  abstain: boolean;              // true → UI shows "inconclusive, see a professional"
  quality: { ok: boolean; issues: string[] };
  model: { name: string; version: string };   // provenance on every prediction
}
interface LesionExplanation {
  patientSummary: string;        // plain language
  education: string;
  referral: { recommended: boolean; urgency: "routine" | "soon" | "urgent"; reason: string };
  doctorSummary?: string;
  disclaimer: string;            // mandatory
  promptVersion: number;
  source: "gemini" | "builtin";  // builtin = offline fallback content
}
```
Frontend renders these two shapes and nothing else → **any model swap (B0→B3/ConvNeXt/ViT) touches only `ai/`**.

## Safety policy (non-negotiable, mirrors existing invariants)

- **Abstain:** top-confidence < 0.55, quality fail, or prediction-entropy > threshold → `abstain: true`; Gemini explains the inconclusiveness; UI shows referral guidance, never a label.
- **Malignant escalation:** MEL/BCC/SCC in top-3 above a low floor (0.15) → `referral.recommended: true` always. A malignant label is NEVER shown without referral text. (Analog of the existing "attention severity → referral" guardrail.)
- **Gemini constraints (enforced by prompt + `checkOutputGuardrails` + critique pass, all retained):** no independent prediction, no overriding/reranking the classifier, no certainty language ("is", "definitely"), no treatment prescriptions, mandatory disclaimer, uncertainty framed as "the analysis suggests… a professional must confirm".
- **Privacy improves:** in close-up mode the image never leaves the machine (Gemini gets JSON only). Face mode keeps its existing consent-gated image upload.

## Folder placement (hybrid architecture)

```
ai/
├── service/                 # NEW — FastAPI, the only runtime AI process
│   ├── main.py              # /healthz, POST /v1/classify (multipart or b64)
│   ├── classifier.py        # registry-driven load + predict
│   ├── preprocess.py        # imports training/transforms.py (train/serve parity)
│   ├── quality.py           # OpenCV checks
│   └── schemas.py           # pydantic mirror of ClassificationResult
├── training/
│   ├── transforms.py        # SINGLE source of preprocessing (train + serve import it)
│   ├── train.py             # MPS/CUDA/CPU auto; weighted loss for class imbalance
│   ├── evaluate.py          # balanced acc, macro-F1, per-class sensitivity
│   ├── compare.py           # candidate vs production on the frozen test set
│   ├── promote.py           # candidate→production, old→archive; never overwrite
│   ├── ingest/              # per-source download+checksum scripts
│   ├── dedup.py             # pHash (imagehash, hamming ≤ 4) + source-ID matching
│   └── build_master.py      # manifest.json; lesion/patient-grouped stratified splits
├── models/
│   ├── production/          # current.pt + model.json {arch, version, classes, metrics, dataset-manifest hash}
│   ├── candidate/  archive/
├── evaluation/              # frozen holdout policy + golden ClassificationResult fixtures
├── datasets/                # DATASETS_DIR default: raw/<source>/  master/{images/,labels.csv,manifest.json}  duplicates/
└── llm/                     # existing + explainer.ts (closeup prompt, JSON-in/JSON-out)

backend/modules/analysis/
└── classifier-client.ts     # ClassifierProvider interface + HTTP impl + Fake impl (golden JSON)

infrastructure/docker/       # + `inference` service (python-slim, CPU torch, models/production ro-mount, /healthz)
```

**Model classes:** ISIC 2019's 8 (MEL, NV, BCC, AK, BKL, DF, VASC, SCC). `model.json` declares the class list — the explainer and UI read labels from the result, never hardcode.

**Replaceability seams:** (frontend) wire contract · (backend) `ClassifierProvider` interface · (python) registry + `model.json` declaring architecture → future models are a new loader entry, zero API change.

## Online/Offline Intelligent Mode

**Invariant: classification is fully local.** Model on disk, inference service on localhost — an unplugged laptop analyzes images identically. Internet only enhances the explanation layer.

**Pipeline ordering change (never invalidate a prediction):** classify → **save scan with classifier JSON immediately** → attempt explanation → update row. A Gemini failure mid-flight can never lose or interrupt a completed classification.

| Piece | Design |
|---|---|
| Connectivity monitor | Backend `ConnectivityMonitor` (backend/shared): lightweight probe of the Gemini endpoint — on demand + 30s interval while offline; a failed real Gemini call also flips it offline. Truth lives server-side (survives captive portals that fool `navigator.onLine`). |
| Status surface | `GET /api/health` → `{ ok: true, llm: "online" \| "offline" }`. Frontend `use-connectivity` hook: `navigator.onLine` events as fast hint + health polling (~15s while a builtin explanation is on screen, idle otherwise). |
| Online flow | classify local → save → Gemini explainer (10s timeout, aborted gracefully) → guardrails/critique → update scan. Explanation persists in the scan row = the required local cache. |
| Offline flow | classify local → save → attach **built-in explanation** from `ai/llm/fallback/lesion-education.ts` (authored per-class content: 8 classes + abstain; same `LesionExplanation` shape, `source: "builtin"`, referral rules applied deterministically). UI renders identically + banner: "Enhanced AI explanation unavailable offline." |
| Offline→Online while viewing | `use-connectivity` detects the flip → frontend calls **`POST /api/scans/:id/explain`** (idempotent: generates, stores, returns the Gemini explanation for any scan whose explanation is `builtin`) → view swaps content in place. No re-analysis, no user action. |
| Online→Offline mid-request | Gemini call abort → builtin fallback substituted → scan (already saved) updated; prediction untouched. |
| Backfill (optional) | `POST /api/explanations/backfill` — upgrade every `builtin` scan in one sweep after a long offline stretch. |

Guardrails/critique run only on Gemini output; builtin content is pre-authored and reviewed once (doctor sign-off recommended), versioned like prompts.

## Retraining workflow (manual, `make -C ai …`)

`ingest` → `dedup` (never train on duplicates; removals logged to `datasets/duplicates/`) → `build-master` (**dedup BEFORE splitting; HAM10000 grouped by lesion_id, patient-level splits — prevents leakage**; frozen test set versioned by manifest hash, never trained on) → `train` → `evaluate` → `compare` (promote ONLY if macro-F1 improves AND melanoma sensitivity does not regress) → `promote` or leave in `archive/`. Doctor-approved clinic images enter via the same ingest+dedup gate.

## Dependency & runtime rules

- frontend → backend → { ai-service (HTTP), database } · Gemini called by backend only · inference service bound to localhost/compose network, never public.
- **The frontend→ai build-time exception is retired** with the browser classifier. Decommission list: `ai/classifier/*` (TS), `frontend/.../ml/classify.worker.ts`, `use-classifier.ts`, classifier branch of `use-analysis`; face mode becomes its existing "llm-only" path as the normal path; `ai/shared/verdict.ts` merge logic retires with it (face report renders directly).
- Degradation: inference service down → scan saved `partial`, honest "analysis unavailable" (existing pattern). `FAKE_CLASSIFIER=1` + `dev:lite` → full app with golden JSON, no Python running.
- Dev: `make -C ai serve` runs FastAPI natively (MPS on this Mac). Docker `inference` container serves CPU (B0 ≈ tens of ms — fine for clinic volume).

## Testing

- **Python (pytest):** transforms parity (train vs serve produce identical tensors), dedup, quality thresholds, registry compare/promote on tiny fixtures.
- **Node (vitest):** contract validation of golden `ClassificationResult`; explainer prompt + guardrails with mock provider; supertest e2e via Fake classifier provider.
- **Frontend:** renders from wire-contract fixtures only.

## Open items
- Gemini free-tier limits for explainer volume (text-only calls are cheap — likely fine).
- ISIC/Kaggle account needed for dataset downloads.
- UI for close-up results (new lesion result view) — separate plan.
