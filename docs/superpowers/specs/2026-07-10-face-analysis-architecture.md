# Whole-Face Skin Analysis — Master Architecture (v3)

Date: 2026-07-10 · Status: **master architecture document — no code yet**
Supersedes for v1 scope: `2026-07-10-ai-classifier-architecture.md` (that spec is now the **future lesion module** design; its Plans 7–9 + branch `feat/ai-classifier` are parked, not deleted).

## 0. Product restatement

Guided multi-angle facial scan (Face-ID-style) → local per-image analysis → merged comprehensive aesthetic skin report (12 dimensions + score + recommendations) → Gemini enhances explanations when online. Offline-first PWA. Manual, admin-gated model lifecycle with rollback. Lesion analysis is a separate future module.

## 1. Key decisions (settled here, as requested)

### D1 — How each skin dimension is analyzed: **modular per-dimension analyzers; deterministic CV in v1; individually upgradeable to specialized models; single multi-task model deferred**

The delegated question was "one multi-task model vs multiple specialized models." The answer for v1 is *neither is trainable today*, and the architecture must make the choice **swappable per dimension**:

- **Data reality:** no public dataset labels all 12 aesthetic dimensions on consumer multi-angle photos. A multi-task model needs jointly-labeled data (doesn't exist); N specialized models need N datasets (only acne has a usable public one). Training either now is fiction.
- **v1 analyzers are deterministic CV** on landmark-defined zones: this ships offline analysis with zero training data, is debuggable by one developer, and honors the existing "camera-honest" invariant (real pixel math, labelled as such — the current `derived-views` redness/texture/pigmentation math is the seed).
- **Every analyzer implements one interface** (`(zonedImages) → DimensionScore {score, confidence, evidence}`). A learned model for one dimension (e.g., an acne grader trained on clinic-accrued, doctor-scored data) replaces that one analyzer without touching the other 11 — matching the manual per-candidate promotion workflow and keeping regressions isolated.
- **Single multi-task model is the possible endgame** (cheaper inference once ≥ several dimensions are learned) — revisit only when a jointly-labeled dataset exists. The merge layer and wire contract are model-count agnostic, so this migration never touches UI or API.

### D2 — Where analysis runs: **in the browser (on-device)**
An offline-first *installed PWA* that analyzes without internet forces client-side inference. MediaPipe Tasks Vision (already a dependency) runs face detection + 478-point landmarks on-device (WASM/WebGPU); analyzers are TypeScript pixel math; future learned models ship as ONNX/TFLite cached by the service worker. The hybrid-architecture boundary exception (frontend imports `ai/` at build time) becomes the *central* pattern, not an exception to retire. The backend never sees an image until the user's device syncs history.

### D3 — Gemini gets JSON only (carried over)
Enhancement calls send the merged report JSON — never images. Existing guardrail/critique machinery is reused. Built-in per-dimension educational content covers offline (same shape, `source: "builtin"`).

### D4 — Face detection/landmarks: **MediaPipe Face Landmarker**
On-device, no training, no server, gives detection + orientation (head pose from landmarks) + the zone geometry (forehead/cheeks/nose/chin/periorbital) the pipeline needs. Zone definitions map landmark indices → polygons, shared by capture guidance and analyzers.

### D6 (v3.1 revision) — Inference abstraction layer: **ModelManager + interface-first, MockClassifier for dev, ONNX reserved**
- **No untrained dev model ships, ever.** The lesion-era `make_dev_model` (random weights) is removed; development and tests use a **`MockClassifier`** implementing the same `Classifier` interface — deterministic, honest, zero download.
- **`ModelManager`** (client, `ai/face/models/manager.ts`): single owner of model lifecycle — registers framework loaders, activates descriptor versions, reports `versions()` into every report's `modelVersions`. The MediaPipe landmarker is its first managed model; future learned per-dimension models and the future lesion classifier join the same registry.
- **Classification and explanation are separate services** end-to-end: local inference (analyzers/classifiers via ModelManager) never calls the network; explanation (Gemini proxy or builtin) never scores skin.
- **Reserved, not built:** `OnnxClassifier` (onnxruntime-web) slot behind the `Classifier` interface — the future lesion module and learned analyzers load through it; adding it is a loader registration, not a refactor. `ModelUpdateService` interface reserved in Phase A types; implemented in Phase D.
- **`ConnectivityService`** (client): one named service exposing both axes — `backendReachable` and `llmAvailable` — consumed by the sync queue, explanation upgrades, and UI badges. Hooks wrap the service; no component polls ad-hoc.

### D7 (v3.1) — Backend does **no runtime inference**
Backend responsibilities are exactly: **training** (offline Python toolkit), **authentication**, **synchronization** (scan/history persistence), **model distribution** (manifest + artifacts + promote/rollback), and **LLM proxying** (Gemini key custody — explanation only, never scoring). The FastAPI runtime-inference service from the parked lesion plan is superseded: the future lesion module runs ONNX **in the browser** through ModelManager. The Python code remains solely as the training/dataset toolkit.

### D8 (v3.1) — Expanded model metadata
Every distributed model carries a full descriptor: `{name, version, task, framework, files[{path,sha256,bytes}], inputSpec, classes?, metrics?, datasetManifestSha256?, createdAt, notes}`. The registry keeps every version (promote/rollback = status flips, never deletes); clients keep the previous cached version until a new one fully verifies (local rollback).

### D5 — In-flight lesion work: **parked, becomes the future module**
Plans 7–9, the lesion spec, and branch `feat/ai-classifier` (2 commits: python scaffolding + transforms) are the future Skin Spot module's head start: separate pipeline, datasets, models, UI — exactly as this spec's "future optional module" requires. Nothing to unwind.

## 2. Updated system architecture

```
┌─ PWA (browser, offline-capable) ─────────────────────────────┐
│ Guided capture (5 angles, live guidance)                     │
│   → per-image quality validation (local)                     │
│   → MediaPipe detection + landmarks (local)                  │
│   → zone extraction → per-dimension analyzers (local)        │
│   → cross-angle merge → FaceReport JSON (local)              │
│ IndexedDB: pending scans, history cache                      │
│ Service worker: app shell + model artifacts (versioned)      │
└──────────────┬───────────────────────────────────────────────┘
               │ when reachable (sync)
┌─ Backend (Node/Express — unchanged tiers) ───────────────────┐
│ scans + scan_images persistence · history API                │
│ Gemini enhancer (JSON-only, guardrails+critique)             │
│ ConnectivityMonitor (`/api/health.llm`)                      │
│ Model distribution: manifest + artifacts + rollback          │
└──────────────┬───────────────────────────────────────────────┘
        Postgres (local)          Gemini API (only external call)
```

Dependency rules unchanged: frontend→backend→{database, Gemini}; `ai/` is a build-time library for the frontend and a content/tooling home — it still never touches the database or routes.

## 3. AI pipeline (per scan)

**Per image (×5 angles):**
1. **Capture guidance** — live overlay drives the pose sequence (front → L45 → R45 → L-profile → R-profile); instructions ("look straight ahead", "turn slightly left", "more light") derived from live landmark/pose + luma checks.
2. **Quality validation** (all local, blocking with retake loop): face detected · yaw/pitch within the target angle's window · sharpness (Laplacian) · lighting (luma range) · face-in-frame ratio ≥ threshold · motion blur · occlusion heuristic (landmark visibility score) · eyes visible for front/45° views.
3. **Landmarks** → head pose + zone polygons (forehead, nose, left/right cheek, chin, periorbital, under-eye).
4. **Skin region extraction** — zone masks minus eyes/brows/lips/hairline.
5. **Per-dimension analyzers** run on the zones **visible in this view** (angle-aware: L-profile contributes left cheek/jaw only).
6. Per-image result: `{angle, quality, poseActual, zones: [{zone, metrics…}]}`.

**Merge (after all required angles):**
- Per zone: quality-weighted combination across views that saw it (45° views are authoritative for cheeks; front for forehead/nose/under-eye).
- Per dimension: aggregate zone scores → `{score 0..1, confidence, perZone[], evidence}`. Confidence = f(image quality, zone coverage, cross-view agreement) — disagreement between views lowers confidence, honestly.
- Overall skin health score = weighted roll-up (weights versioned in the report, never hidden).
- Recommendations: deterministic rules table keyed by dimension scores (v1) — skincare + treatment suggestions with the medical disclaimer; Gemini may *rephrase and personalize*, never invent clinical claims (guardrails).

**Wire shape (sketch, exact contract at Phase A):** `FaceReport { kind:"face-v2", overall, dimensions: Record<DimensionKey, {score, confidence, perZone, evidence}>, capture: {angles, quality}, recommendations, explanation {source: gemini|builtin}, disclaimer, pipelineVersion, modelVersions }`. The existing 12 `DIMENSION_KEYS` in `shared/contract.ts` map 1:1 onto the required outputs (acne, pigmentation, redness, texture=wrinkles-texture split into fine-lines/wrinkles/texture in v2 keys, pores, oiliness, dryness=hydration-appearance, under-eye added, tone consistency added).

## 4. Folder integration (hybrid architecture)

```
ai/
├── face/                    # NEW — browser-side pipeline (TS, build-time import)
│   ├── pipeline.ts          # orchestrator: image → per-image result; results → merged report
│   ├── landmarks/           # MediaPipe wrapper, head pose, zone polygons (landmark-index maps)
│   ├── quality/             # per-image validation (reuses/extends existing ai quality math)
│   ├── analyzers/           # one file per dimension, all implementing Analyzer
│   ├── merge/               # cross-angle fusion + confidence + overall score
│   ├── recommend/           # deterministic recommendation rules (versioned)
│   └── guidance/            # capture-sequence state machine + instruction strings
├── llm/                     # existing — + face-report explainer prompt (JSON-only) + builtin content
├── models/face/             # versioned artifacts for distribution (v1: mediapipe task files); production/candidate/archive per model
├── service/, training/, …   # PARKED (future lesion module + future learned-model training)
frontend/src/features/skin-analysis/
├── components/capture/      # guided multi-angle stepper UI (extends CaptureFlow)
├── components/results/      # FaceReport v2 views (responsive, per spec §7 of prior spec)
backend/modules/
├── analysis/                # + face-scan persistence routes + enhance endpoint
├── models/                  # NEW — model manifest + artifact serving + admin promote/rollback
├── history/  (or reuse patients/scans)   # history queries
infrastructure/              # unchanged; nginx serves PWA assets + long-cache model files
```

## 5. API integration (endpoint sketch)

| Route | Purpose |
|---|---|
| `POST /api/face-scans` | persist a completed scan: merged report + per-image metadata (+ images) — accepts the *client-computed* report; server validates against contract + re-checks guardrail invariants |
| `GET /api/patients/:id/face-scans` · `GET /api/face-scans/:id` | history |
| `GET /api/face-scans/:id/images/:angle` | stored image retrieval |
| `POST /api/face-scans/:id/enhance` | Gemini enhancement of a builtin explanation (idempotent; 503 offline) — same pattern as the designed lesion `explain` endpoint |
| `GET /api/health` | `{ok, llm: online\|offline}` (as previously designed) |
| `GET /api/models/manifest` | `{models:[{name, version, files[{path,sha256,bytes}]}]}` — what an installed PWA should have |
| `GET /api/models/files/:name/:version/:file` | artifact download (immutable, cache-forever) |
| Admin (auth, same session): `POST /api/models/:name/promote` · `POST /api/models/:name/rollback` | manual deploy / rollback |

QR remote-capture sessions extend naturally: the phone can run the guided capture and submit all five angles through the existing token mechanism.

## 6. Database changes

```sql
-- scans stays (face v1 + lesion-future compatible); merged report lives in scans.report JSONB (kind:"face-v2")
CREATE TABLE IF NOT EXISTS scan_images (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scan_id UUID NOT NULL REFERENCES scans(id) ON DELETE CASCADE,
  angle TEXT NOT NULL CHECK (angle IN ('front','left-45','right-45','left-profile','right-profile','forehead','chin')),
  image_jpeg BYTEA NOT NULL,
  image_width INT NOT NULL, image_height INT NOT NULL,
  quality JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS scan_images_scan ON scan_images (scan_id);

CREATE TABLE IF NOT EXISTS model_registry (
  name TEXT NOT NULL, version TEXT NOT NULL, status TEXT NOT NULL CHECK (status IN ('production','candidate','archived')),
  manifest JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (name, version)
);
```
`scans.image_jpeg` keeps the front view (thumbnail + back-compat); additional angles in `scan_images`. Schema stays idempotent-self-applied (additive `IF NOT EXISTS` — existing installs migrate on boot, consistent with current practice).

## 7. Storage strategy

| Data | Where | Why |
|---|---|---|
| App shell (HTML/JS/CSS) | Service-worker precache | offline launch |
| Model artifacts | Cache Storage, keyed `name@version` | immutable, verified by sha256 from manifest; old versions purged after switch |
| Pending scans (offline) | IndexedDB queue (report JSON + JPEG blobs) | survive restarts; synced FIFO when backend reachable |
| History cache | IndexedDB (reports only, image thumbnails optional) | offline viewing of past results |
| Canonical history | Postgres (scans + scan_images) | existing local-first clinic store, `make backup` unchanged |
| Explanations | inside the scan report row (and IndexedDB copy) | the "cache explanations" requirement, no new layer |

## 8. Offline-first behavior & connectivity

- **Analysis never needs the network** (D2). Capture → report works on an unplugged device.
- **Backend unreachable** (device away from clinic): scan queues in IndexedDB; history shows it as "pending sync"; sync worker flushes on reconnect (Background Sync API where available, foreground retry otherwise).
- **Gemini unreachable** (backend up, internet down): report saves with `explanation.source:"builtin"`; the previously-designed pieces are reused verbatim — backend `ConnectivityMonitor`, `/api/health.llm`, frontend `use-connectivity` (navigator.onLine hint + poll), auto `enhance` on reconnect, explanation swaps in place without rescanning.
- Two independent connectivity axes, surfaced separately in UI: *backend reachable?* (sync state) and *LLM reachable?* (explanation state).

## 9. Model management strategy

- **Distribution:** every installed PWA checks `GET /api/models/manifest` on launch/interval; downloads changed artifacts, sha256-verifies, atomically switches the Cache Storage key, reloads the pipeline. The report records `modelVersions` used.
- **Central master server:** for v1 this is the clinic backend itself (single source). The manifest format is host-agnostic so a hosted master server later is a URL change.
- **Lifecycle (all manual, admin = logged-in operator):** approved data review → duplicate detection (pHash toolkit from the parked training work) → dataset validation → admin-initiated training → candidate evaluation vs production on a frozen set → **manual promote** → distribution via manifest bump. **Rollback** = repoint production to any archived version (registry keeps everything; artifacts immutable).
- v1 ships only the MediaPipe task file through this channel — the machinery is proven cheap before any learned model exists.

## 10. Future extensibility

- **Skin Spot / Lesion module (designed, parked):** separate workflow/UI/datasets/models/pipeline = the existing lesion spec + Plans 7–9 + `feat/ai-classifier` branch. Shares only: wire-contract conventions, guardrails, connectivity, model distribution. Adding it later touches no face-pipeline file.
- **Per-dimension learned models:** replace one analyzer at a time (D1) — ONNX in-browser via the distribution channel; the Python training toolkit (parked Plan 8) is the trainer.
- **Optional close-up captures** (forehead/chin): the angle enum + guidance state machine already reserve them.
- **Multi-task consolidation:** merge layer is input-agnostic; revisit when jointly-labeled data exists.

## 11. Development phases (implementation plans to be written per phase)

| Phase | Delivers | Proves |
|---|---|---|
| **A — Contracts + local pipeline core** | `FaceReport` contract; landmarks wrapper + zones; quality validation; 12 v1 analyzers; merge + confidence; recommendation rules — all headless + unit-tested on fixture images | analysis correctness without any UI |
| **B — Guided capture UX** | multi-angle stepper with live guidance, per-image validation + retake loop, responsive (375/768/1280), touch-first | the Face-ID-like experience end-to-end on-device |
| **C — Persistence + explanation** | scan_images schema, face-scan routes, history UI, Gemini enhancer + builtin content + reconnect upgrade (reuses designed connectivity pieces) | full online/offline explanation story |
| **D — PWA + sync + model distribution** | manifest/service worker, IndexedDB queue + sync, model manifest/serving/rollback, installability | offline-first as a property, not a feature |
| **E — (future) Lesion module** | un-park Plans 7–9 | separate module lands without touching A–D |

Each phase gets a full TDD plan (writing-plans format) before implementation; A is the only prerequisite for B and C; D last because it wraps a working app.

## 12. Requirement→design traceability

Every §OUTPUT item: architecture (§2), AI pipeline (§3), folder integration (§4), API (§5), DB (§6), storage (§7), offline-first (§8), connectivity (§8), model management (§9), extensibility (§10), phases (§11). Results list (§3 merge + wire shape): overall score ✓, all 12 assessments ✓, confidence ✓, recommendations ✓, AI explanation ✓, disclaimer ✓. History (§5/§6/§7) ✓. Capture guidance + quality validation (§3) ✓. Manual model lifecycle + rollback (§9) ✓. Future lesion module isolation (§10) ✓.
