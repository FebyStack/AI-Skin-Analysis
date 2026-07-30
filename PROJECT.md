# AI Skin Analysis — Project Memory

Local clinic web app: patient skin scans (face + body), dual-AI analysis (on-device ONNX classifier + **Gemini** vision + critique pass), stored locally in Postgres. Not public — one clinic, one laptop, portable via DB backup/restore. QR lets a phone act as a remote camera.

Spec: `docs/superpowers/specs/2026-07-03-ai-skin-analysis-design.md` (v2, Clinic Edition).

## Layout — Hybrid Architecture (migrated 2026-07-10)

Full old→new mapping + rationale: `docs/migration/2026-07-10-hybrid-architecture-migration.md`.

- `frontend/` — React SPA (vite root). Feature slice: `frontend/src/features/skin-analysis/`.
- `backend/` — Express. `modules/{auth,patients,analysis,capture,settings}` (routes + service + repository each), `middleware/`, `app/app.ts` (composition root), `server/index.ts` (Postgres entry) + `index-lite.ts` (in-memory, no Docker). `dashboard/reports/comparison/dataset/training` are empty skeletons for future work.
- `ai/` — `llm/` (pipeline, prompts, guardrails, critique, Gemini provider), `classifier/` + `shared/` (pure browser ML: classifier, labels, quality, verdict, derived-views), `evaluation/fixtures/` (golden report), `training/` (dummy-model generator), `models/` (registry doc — served ONNX lives in `frontend/public/models/`).
- `shared/` — `contract.ts` (single wire contract — the old frontend mirror was deleted after byte-identical verification) + `types.ts` (domain types; feature barrel re-exports them).
- `database/` — `schema/schema.sql` (self-applied on api boot, idempotent), `backups/` (make backup target).
- `infrastructure/docker/` — Dockerfile (+`Dockerfile.dockerignore`), compose files (**project name pinned `skinanalysis`** to keep the pre-migration `skinanalysis_skin_data` volume), nginx.conf. Root `Makefile` delegates with `-f … --env-file .env`.
- Aliases: `@` → frontend/src, `@ai` → ai, `@shared` → shared (tsconfig + vite + vitest).
- **Boundary rule + its one exception:** frontend talks only to backend; backend is the only AI caller — EXCEPT the on-device classifier, which the frontend imports from `ai/` at build time (browser-side inference IS the privacy design; never move it server-side).

## Provider & billing

Gemini (`@google/genai`, default `gemini-2.5-flash` for primary + critique), key in `.env` `GEMINI_API_KEY`. No Anthropic API key anywhere (subscription-only billing rule). `makeTestDeps` still uses claude-* model ids as fake strings — harmless, tests never call a network.

## Run

- Dev (local Homebrew Postgres 18.3, no Docker): `npm run dev:server` + `npm run dev` (or `dev:all` with Docker db, `dev:lite` for in-memory). `.env` has GEMINI_API_KEY, DATABASE_URL (lowercase `skin` db), PORT.
- Verify: `npm run verify` (typecheck ×2 + vitest + build). Schema is read from `database/schema/schema.sql` relative to **cwd** — run server from repo root.
- Docker: `make up` / `make build` / `make backup` (→ `database/backups/`) / `make restore FILE=…`.

## Plan status

**Current branch `feat/face-analysis`:**
- Plans 10 (face pipeline core) + 11 (guided capture) executed — on-device MediaPipe + per-dimension CV analyzers, all committed. Plan 8 (Python training toolkit) executed + review-fixed. Full suite green (246 TS + 29 py).
- **Pretrained-model pivot (2026-07-10→11, Febriel):** dropped "train our own" in favor of a **real pretrained ISIC/PAD-UFES-20 6-class EfficientNet-B1** (timm, HF `conan17970/efficientnet-b1-skin-cancer-isic2019`, F1 0.688, runs on MPS) + YOLO11n + MobileSAM weights. Now wired: `ai/models/manager.py` (lazy singleton ModelManager), `ai/inference/lesion_classifier.py` (predict/predict_image, weights_only=True), `ai/inference/pipeline.py` (detect→crop→classify, whole-image fallback since yolo11n is a generic placeholder detector). Verified end-to-end on MPS; 4 pipeline unit tests.
- **Weights are gitignored** (69MB) + `MobileSAM/` clone (181MB); re-fetch with `.venv/bin/python -m ai.models.fetch_models`. No git LFS.
- Roadmap in the v3 master arch (`docs/superpowers/specs/2026-07-10-face-analysis-architecture.md`); Phases C/D (Plans 12/13: persistence+explanation, PWA+sync+models) not yet executed. Still TODO: complete ModelManager wiring into a unified face+lesion pipeline, segmentation/quality/skin-attribute models, FaceReport extension, lesion-trained detector.

Plans 1–4 executed and merged. Plan 5 (results/report UI) + Plan 6 (patients/history/QR UI) code was written and committed by Febriel in `a5920b5` (2026-07-10) — **2 tests in that WIP still fail** (verdict summary wording vs `/partial/i`; quality-gate missing `unsupported-aspect-ratio`) and 2 TODO(plan-6)s remain (real patient selection; results fetch of stored report). The `walk-in` sentinel patient hack in patients/analysis routes awaits Plan 6.

## Architecture invariants (do not weaken)

- **Guardrail chain (safety-critical):** LLM output must pass `checkOutputGuardrails` (`ai/llm/guardrails.ts`) — no diagnosis/benign/malignant/prescription language, mandatory disclaimer, professional referral whenever any finding is `attention`. Amended critique reports are re-scanned by the same guardrail.
- **Verdict merge** (`ai/shared/verdict.ts`): severity escalates if *either* source flags (never averaged down); agreement confidence `1-(1-a)(1-b)`, capped .99.
- **Derived views are camera-honest:** real pixel math from the one RGB photo, labelled as such — never fake UV/IR/3D.
- **QR capture:** single-use ~5-min token IS the authorization (upload-only, no phone login). In-memory store is intentional.
- **Images:** sharp re-encode ≤1280px JPEG q80, EXIF stripped via `.rotate()`; stored in `bytea` next to JSONB report.

## Environment gotchas

- Node v22.23.1 (homebrew, switched from 25.9.0 on 2026-07-12; nvm has the same). **vitest 2.1.9 hangs are NOT a Node-version issue** — verified 2026-07-20: a single-file run hangs under the Claude-harness shell on node 22 while the same command runs green in a normal terminal. It's a harness-environment quirk (non-TTY stdout/injected env), intermittent, and node-version-independent. Rule: agents should rely on exit codes/user-run results for vitest; the user's terminal is the source of truth for suite status.
- jsdom polyfills in `frontend/src/test/setup.ts` are load-bearing (broken localStorage, no Blob.text/Worker; `window` guard for node-env test files). Don't delete.
- `vite.config.ts` `worker.format: "es"` is required by onnxruntime-web.
- Docker: `Dockerfile.dockerignore` must exclude `.venv` (torch venv at repo root) and node_modules or `COPY . .` breaks native binaries; server bundle is CJS → `dist-server/index.cjs`; pg restore needs `--clean --if-exists` (schema self-applies on boot).
- Root debris awaiting Febriel's call: `hello.test.ts`, `test-db.js`, `vitest.min.config.ts` (vitest-hang debugging leftovers, committed in a5920b5); committed 8.8MB `frontend/public/models/skin-classifier.onnx.data`.

## Process (for continuity)

Brainstorm → spec → writing-plans → subagent-driven execution with one final opus review before merge. Verify camera/browser changes live in the preview tool, not just unit tests. `git push` to `https://github.com/FebyStack/AI-Skin-Analysis.git` was configured via `gh auth git-credential` but never confirmed pushed.

### Consistency, archive, lifecycle + analytics (2026-07-28)

Five features on top of the queue/governance stack:

- **Label Consistency Checker** (`shared/label-consistency.ts`). Compares a saved
  label against the patient's most recent APPROVED visit. Flags a jump of
  `LEVEL_JUMP = 2` severity levels inside `SHORT_PERIOD_DAYS = 30`. Skips
  `skintype` — it's categorical, so oily→dry is not a "jump". Advisory only: the
  reviewer sees a banner (Review again / Edit label / Approve anyway) and every
  warning is written to `scan_events` as kind `warning` for audit.
- **Image Lifecycle Tracking** (`shared/lifecycle.ts` + `scan_events` table). An
  append-only event log: captured → analyzed → reviewed/approved/rejected →
  dataset → trained, plus archived/restored/purged/warning. Timeline renders in
  the annotation panel; feed is `GET /api/training-queue/:scanId/events`.
- **Image Archive** (30-day retention). Deleting an angle now ARCHIVES it —
  `scan_images.archived_at` is stamped, and `listImages` excludes archived rows in
  both repo impls, so it vanishes from the scan but stays recoverable. Expiry is
  swept lazily on `GET /api/archive` (a clinic laptop isn't always on, so a timer
  would miss days). Restore + permanent delete under `/api/archive/...`.
- **Clinic Analytics** (`GET /api/analytics`): patients, visits, analyses, modal
  skin type + acne severity, mean confidence, mean review time, queue counts, plus
  dataset-growth and model-performance series. Charts are inline CSS bars — no
  chart library, no bundle weight. Lives at the top of the Training view.
- **Training Sandbox**: already satisfied by the existing candidate/production/
  archived model-release states + the deploy gate (`candidateBeatsProduction`), so
  no new surface was added — a candidate IS the isolated experiment.

Bug found and fixed while testing: `listImages` returned archived angles in both
`MemoryScanRepo` and `PgScanRepo`, so archiving would not have removed the image
from the scan. Postgres now filters `archived_at IS NULL`.

`npm run lint` fails repo-wide — there is no `eslint.config.js` (pre-existing,
unrelated to this work).

### Motion system + 3D zone map (2026-07-28)

Installed 19 skills (`.claude/skills/`, tracked in `skills-lock.json`): CloudAI-X
three.js ×10, GreenSock GSAP ×8, LottieFiles motion-design ×1. Note the GSAP repo
is `greensock/gsap-skills`. No Lottie *runtime* was added — that skill is motion
principles, not a player, so it costs no bundle.

**Brand motion identity** (`frontend/src/motion/tokens.ts`) — archetype Premium:
signature easing `cubic-bezier(0.32,0.72,0,1)` (already the CSS `ease-spring`),
durations quick 160 / standard 320 / slow 620ms, entrance = rise 16px + fade,
zero overshoot. `staggerFor(n)` clamps any cascade to the 500ms stagger budget.
Clinical rule on top: motion never delays or hides a result.

**`useReveal()`** (`frontend/src/motion/useReveal.ts`) — `useGSAP` with a scope
ref, `gsap.matchMedia()` for `prefers-reduced-motion`, animating *from* an offset
so content is never left invisible. Applied to FaceReportView + AnalyticsDashboard.

**3D zone map** (`FaceZoneMap3D.tsx`, behind `ZoneMap.tsx`) — a schematic head
painting per-zone severity from `report.dimensions[d].perZone`. Zones are declared
as `[yaw°, pitch°]` directions and *projected onto the head surface* rather than
hand-typed xyz; the first hand-typed version buried 2 of 7 markers inside the mesh
and made the eyes/mouth invisible. Positive yaw = the patient's LEFT = viewer's
right, matching a frontal photograph.

Guardrails, given the earlier iOS OOM: three.js is a `React.lazy` chunk
(135 kB gz) that never enters the main bundle and is only fetched when
`isMemoryConstrained()` is false AND WebGL exists — so iPhones/iPads never load
it. Pixel ratio capped at 2, rAF stopped via IntersectionObserver + visibility.
The zone bars are always rendered and are the source of truth; the head is a
garnish.

**Bundle cost, measured:** GSAP adds **+29.5 kB gz** to the main chunk
(123.6 → 153.1). three.js adds 0 to it. If that 29.5 kB is unwelcome, `useReveal`
is the only GSAP consumer and could be lazy-loaded or swapped for the existing
CSS `animate-rise`.

Test-env note: jsdom implements no `matchMedia`, which GSAP needs, so
`frontend/src/test/setup.ts` now polyfills it (reporting "no preference").

last Claude session: 2026-07-30 09:22

## Recent updates (2026-07-12)

- Plan 13 (model distribution + PWA): completed server-side model registry, versioned uploads, promote/rollback endpoints, static serving under /models, and client-side ModelUpdateService that verifies downloads (SHA-256) and caches blobs in IndexedDB.
- Camera "always starting" bug fixed: camera starts once on mount and stops on unmount; removed restart loop and added cleanup.
- Frontend now prefers cached model blobs for the classifier and MediaPipe face landmarker when available.
- Admin UI: ModelManager added and admin actions gated by session auth (/api/auth/status check). Upload/promote/rollback endpoints require session auth on the server.
- Tests: full verify run locally — 290 tests passed.

### Files of interest
- backend/modules/models/* (repository, service, routes, upload-route)
- backend/app/app.ts (static /models and conditional upload mount)
- frontend/src/features/skin-analysis/pwa/model-update-service.ts
- frontend/src/features/skin-analysis/ml/classify.worker.ts
- ai/face/landmarks/mediapipe.ts
- frontend/src/features/skin-analysis/components/admin/ModelManager.tsx

### Next recommended steps
1. Harden uploads: admin roles, file size limits, virus scanning.
2. Add integration tests for upload→promote→client-download flow.
3. Decide model asset packaging for CI/Docker: bake into image vs deploy-as-hosted assets.

To push these commits from your environment:
  git push origin febystack-ubiquitous-disco

If you'd like, I can push them now; otherwise run the command above to push.

## Status audit 2026-07-15 (full-codebase analysis)

Complete state audit filed in Obsidian: `Claude Code/AI Skin Analysis Status 2026-07-15.md`.
Headlines: both AI branches functional (face on-device pipeline + lesion EfficientNet-B1 w/ MobileSAM refinement + localization confidence); model distribution platform + admin UI landed via PR #4.
**Dormant/missing:** PWA icons never generated (`node scripts/generate-icons.mjs`); face-parsing ONNX never downloaded (`.venv/bin/python -m ai.models.fetch_models face-parsing`) so segmentation silently falls back to landmark polygons; MobileSAM real-weights path never run on an actual photo; upload→promote→download integration test missing; main 1 commit ahead of origin; stale `feat/face-analysis` branch to delete after confirming superseded.

### Consistency, archive, lifecycle + analytics (2026-07-28)

Five features on top of the queue/governance stack:

- **Label Consistency Checker** (`shared/label-consistency.ts`). Compares a saved
  label against the patient's most recent APPROVED visit. Flags a jump of
  `LEVEL_JUMP = 2` severity levels inside `SHORT_PERIOD_DAYS = 30`. Skips
  `skintype` — it's categorical, so oily→dry is not a "jump". Advisory only: the
  reviewer sees a banner (Review again / Edit label / Approve anyway) and every
  warning is written to `scan_events` as kind `warning` for audit.
- **Image Lifecycle Tracking** (`shared/lifecycle.ts` + `scan_events` table). An
  append-only event log: captured → analyzed → reviewed/approved/rejected →
  dataset → trained, plus archived/restored/purged/warning. Timeline renders in
  the annotation panel; feed is `GET /api/training-queue/:scanId/events`.
- **Image Archive** (30-day retention). Deleting an angle now ARCHIVES it —
  `scan_images.archived_at` is stamped, and `listImages` excludes archived rows in
  both repo impls, so it vanishes from the scan but stays recoverable. Expiry is
  swept lazily on `GET /api/archive` (a clinic laptop isn't always on, so a timer
  would miss days). Restore + permanent delete under `/api/archive/...`.
- **Clinic Analytics** (`GET /api/analytics`): patients, visits, analyses, modal
  skin type + acne severity, mean confidence, mean review time, queue counts, plus
  dataset-growth and model-performance series. Charts are inline CSS bars — no
  chart library, no bundle weight. Lives at the top of the Training view.
- **Training Sandbox**: already satisfied by the existing candidate/production/
  archived model-release states + the deploy gate (`candidateBeatsProduction`), so
  no new surface was added — a candidate IS the isolated experiment.

Bug found and fixed while testing: `listImages` returned archived angles in both
`MemoryScanRepo` and `PgScanRepo`, so archiving would not have removed the image
from the scan. Postgres now filters `archived_at IS NULL`.

`npm run lint` fails repo-wide — there is no `eslint.config.js` (pre-existing,
unrelated to this work).

### Motion system + 3D zone map (2026-07-28)

Installed 19 skills (`.claude/skills/`, tracked in `skills-lock.json`): CloudAI-X
three.js ×10, GreenSock GSAP ×8, LottieFiles motion-design ×1. Note the GSAP repo
is `greensock/gsap-skills`. No Lottie *runtime* was added — that skill is motion
principles, not a player, so it costs no bundle.

**Brand motion identity** (`frontend/src/motion/tokens.ts`) — archetype Premium:
signature easing `cubic-bezier(0.32,0.72,0,1)` (already the CSS `ease-spring`),
durations quick 160 / standard 320 / slow 620ms, entrance = rise 16px + fade,
zero overshoot. `staggerFor(n)` clamps any cascade to the 500ms stagger budget.
Clinical rule on top: motion never delays or hides a result.

**`useReveal()`** (`frontend/src/motion/useReveal.ts`) — `useGSAP` with a scope
ref, `gsap.matchMedia()` for `prefers-reduced-motion`, animating *from* an offset
so content is never left invisible. Applied to FaceReportView + AnalyticsDashboard.

**3D zone map** (`FaceZoneMap3D.tsx`, behind `ZoneMap.tsx`) — a schematic head
painting per-zone severity from `report.dimensions[d].perZone`. Zones are declared
as `[yaw°, pitch°]` directions and *projected onto the head surface* rather than
hand-typed xyz; the first hand-typed version buried 2 of 7 markers inside the mesh
and made the eyes/mouth invisible. Positive yaw = the patient's LEFT = viewer's
right, matching a frontal photograph.

Guardrails, given the earlier iOS OOM: three.js is a `React.lazy` chunk
(135 kB gz) that never enters the main bundle and is only fetched when
`isMemoryConstrained()` is false AND WebGL exists — so iPhones/iPads never load
it. Pixel ratio capped at 2, rAF stopped via IntersectionObserver + visibility.
The zone bars are always rendered and are the source of truth; the head is a
garnish.

**Bundle cost, measured:** GSAP adds **+29.5 kB gz** to the main chunk
(123.6 → 153.1). three.js adds 0 to it. If that 29.5 kB is unwelcome, `useReveal`
is the only GSAP consumer and could be lazy-loaded or swapped for the existing
CSS `animate-rise`.

Test-env note: jsdom implements no `matchMedia`, which GSAP needs, so
`frontend/src/test/setup.ts` now polyfills it (reporting "no preference").

last Claude session: 2026-07-30 09:22

## Progress 2026-07-21 (recommended-steps batch)

Executed the next-steps batch from the Jul-15 audit. Full detail: `Claude Code/AI Skin Analysis Progress 2026-07-21.md`.
**Done:** PWA icons generated (`scripts/generate-icons.mjs`); face-parsing ONNX downloaded (segmentation now live on next reload — upgrades all 11 face dimensions to real skin masks); pushed main to GitHub; deleted stale `feat/face-analysis`; added pg-gated upload→promote→download→rollback integration test (`backend/modules/models/models-flow.integration.test.ts`, `TEST_DATABASE_URL` only); installed MobileSAM (`cd MobileSAM && pip install -e .`); added `ai/inference/verify_sam.py` real-weights sanity script.
**Unverified (harness can't `import torch` OR run vitest — env quirk, NOT code/node):** run `.venv/bin/python -m ai.inference.verify_sam` and the integration test in a normal terminal.
**Next big rock (pick one):** lesion-trained detector · trained acne analyzer · patient management (kill walk-in hack).

## Progress 2026-07-21 (clinic tracks)

3-track sequence for "real clinic tool + genuinely better AI":
- **Track 1 — Patient management** (commit `c619e79`): real patients, walk-in resolves server-side, scans scoped by patientId, PatientBar UI. Done.
- **Track 2 — Trainable acne analyzer** (commit `87740d1`): learned EfficientNet-B0 acne-severity model overriding only the `acne` face dimension (deterministic fallback when ONNX absent). Full improvement loop: `ai/training/acne` trains on external datasets AND exported app scans; `scan_labels` table + training routes + `AcneLabelControl` let a clinician grade a saved scan, and admin export writes labeled scans to `$DATASETS_DIR/acne/scans/<label>/` for retraining. Done — code + typecheck (FE/BE exit 0) + ingest tests (exit 0). **No model.onnx yet** → runs deterministic until first train+export.
- **Track 2b — Trained skin-type dimension** (commit `c7d87ae`): NEW categorical facial signal (normal/oily/dry/combination), same optional-model slot as acne — fills `FaceReport.skinType` when `/models/skintype/model.onnx` is present, omitted otherwise (offline-safe; does NOT touch the 11 deterministic dimensions). `ai/training/skintype` (labels/ingest/train/export/eval/fetch_killa92/tests). `AcneLabelControl` generalized → `ScanLabelControl` (renders acne + skintype graders). Training routes now export by `:dimension`. Typecheck FE/BE exit 0, skintype ingest tests 8 passed. **No model.onnx yet.**
- **Track 3 — Lesion-trained detector:** not started (ISIC 2019 download in progress, slow S3).

**Datasets installed** (in `ai/datasets/`, gitignored — user chose to keep in-project despite iCloud, see memory [[icloud-desktop-datasets]]). Kaggle CLI installed, `~/.kaggle/kaggle.json` in place.
- acne (5-class): ACNE04 (HF, `fetch_acne04`) mild/moderate/severe/very-severe ~99 each + clear 150 (from killa92 normal faces). `.venv/bin/python -m ai.training.acne.{train_acne,evaluate,export_onnx}`.
- skintype (4-class): killa92 (Kaggle, `fetch_killa92`) normal 1399 / oily 1150 / dry 1203 / combination 341. `.venv/bin/python -m ai.training.skintype.{train_skintype,evaluate,export_onnx}`.
- HAM10000 present but iCloud-evicted (10,015 imgs); ISIC 2019 images downloading to `ai/datasets/raw/isic2019/`.

**Migration note:** `scan_labels` table added to `database/schema/schema.sql` (self-applied on boot). Verify it exists after next server boot.
**Runbooks:** `ai/training/acne/README.md`, `ai/training/skintype/README.md`.

### Training results (2026-07-22, run by user on MPS)
- **Transfer-learning fix** (commit `9028047`): `train_one` was random-init → near-random metrics. Now loads ImageNet-pretrained EfficientNet-B0 + fresh head. First run downloads ~20MB weights (cached).
- **ONNX export fix** (commit `12b2520`): pin `dynamo=False` (legacy exporter) — newer torch defaults to dynamo which needs `onnxscript` (now installed) and warns/fails on `dynamic_axes`.
- **Acne trained + exported**: val_macro_f1 0.777, eval macro_f1 0.711, ordinal MAE 0.282. `frontend/public/models/acne/model.onnx` (16MB) live → acne dimension now model-driven on app reload.
- **Skin-type trained** (val_macro_f1 was 0.17 pre-fix; retrained after fix — user re-ran, eval ongoing). Export pending: `.venv/bin/python -m ai.training.skintype.export_onnx` → lights up the Skin Type card.

### Gemini-independence (offline explanation)
- **Stronger builtin** (commit `988edec`): `ai/llm/fallback/face-education.ts` rewritten — uses trained skinType, lists only prominent dims (≥0.4, top 2), dermatologist referral when overall≥0.5 or any dim≥0.7, tighter cosmetic language, no diagnosis words. Version 2. Test `face-education.test.ts` 5/5 pass.
- **Prefer-builtin toggle** (commit `f0da46d`): `PREFER_BUILTIN_EXPLANATION=1` skips Gemini upgrade on save + makes `/enhance` a no-op. With it set (or GEMINI_API_KEY unset) the whole report runs local, no cloud. In `.env.example`.

**Datasets on disk are large:** ISIC 9.1GB (Track 3, `ai/datasets/raw/isic2019/images/` 25,333 imgs); disk ~6GB free (iCloud Desktop). If tight, move datasets to external drive via `DATASETS_DIR` or remove ISIC until Track 3.

### Capture upgrades (2026-07-23, commit `1632242` + fixes `aa6f1e1`/`5fde53c`/`501a8cf`)
- Multi-angle inference: acne/skintype average probs across ALL captured angles, each cropped to its MediaPipe face bbox (geometry tapped in frame-adapter).
- Auto-capture: 350ms landmark-only pose poll, ~1s steady in-window yaw → shoots; oval guide + chevron + progress bar; parse timeout (VITE_PARSE_TIMEOUT_MS, 4s) stops "Analyzing…" hangs; profile yaw windows relaxed to ±[45,90] (asin cap made ±[65,95] unreachable).
- TrainingExport button on result view = one-click graded-scan export (flywheel: grade → export → `make retrain`).
- **Env critical:** `node_modules` is a symlink to `/Users/febrielotud/skin-analysis-deps/node_modules` (no-space, non-iCloud — in-project or `.nosync` paths break vitest with "No test suite found" via %20 realpath). `.venv` → `.venv.nosync`. Never recreate a real in-project node_modules.

- Also `495ad47`: phone-camera augmentation in shared train transforms (JPEG/noise/blur/exposure — retrain to adapt models to phone/iPad quality); history rows expandable (angle images from pg bytea or IndexedDB + 11 dim scores + skinType); before/after front-vs-front with overall delta per patient. `a9dab4f`: training export needs session auth only (admin_enabled was never on).

- `679c809`: results Summary now DISPLAYED in FaceReportView (was computed, never shown); Gemini prompt v2 includes skinType + enforces short 8th-grade summaries (length guardrail). `2b39692`: before/after gated to real patients only (walk-in is a shared bucket → was pairing different people, read as "same as last scan"). `426d3c3`: confidence-gate learned models — acne overrides only when top prob ≥ VITE_ACNE_MIN_CONF (0.40); skinType set only when ≥ VITE_SKINTYPE_MIN_CONF (0.45), else unset (honest on OOD faces like children).

### Data + training viz (2026-07-24)
- Acne data ~2.4x: added Kaggle `rutviklathiyateksun/acne-grading` (49MB, Level_0/1/2→mild/moderate/severe, stem-deduped) → 1311 imgs; retrain eval macro-F1 0.711→0.771. very-severe still weak (96); full 1.1GB ACNE04 drops on slow links. See `ai/datasets/README.md`.
- **Training visualization** (commit `8193cc5`): `train_one` logs per-epoch loss + val macro-F1 to TensorBoard (`ai/models/runs/`, `tensorboard --logdir ai/models/runs`) AND writes `ai/models/<dim>/candidate/progress.json` per epoch; `evaluate.py` appends each run to `ai/models/<dim>/history.jsonl` (`ai/training/history.py`). Backend `GET /api/training/<dim>/{progress,history}`. Frontend **Training tab** (`components/training/TrainingDashboard.tsx`): live epoch progress + before/after macro-F1 per model. train_one now validates each epoch. progress/history/runs gitignored (per-machine).

### Augmentation fix validated + more dimensions (2026-07-27)
- **Skin-type regression solved** (commit `4d9f286`): eval macro-F1 0.686 → 0.558 (bad aug) → **0.773** (fixed). Causes: `VerticalFlip` is wrong for upright faces, and the phone-camera aug was too strong. `train_transforms(face=True)` for acne/skintype/dimensions; lesion keeps vertical flip. **Retrain acne too** — same penalty, masked there by its 2.4x data.
- **4 new trainable dimensions** (commit `05cc1ec`): redness/wrinkles/pores/pigmentation via generic `ai/training/dimension/` (registry in `labels.py` → adding a dimension is one entry). Data seeded from Kaggle `shijo96john/...` (present) + killa92 clear faces (absent), balanced 600/600 (pigmentation 1218/1218). Browser: `ai/face/analyzers/dimension-model.ts`, binary score = P(present), confidence-gated `VITE_DIMENSION_MIN_CONF` 0.55. `make retrain-dim DIM=redness` / `make retrain-dims`. Clinicians grade these absent/present → export → retrain.

### ⚠️ The 4 dimension models were confounded — removed (2026-07-27)

**Do not retrain redness/wrinkles/pores/pigmentation from the Kaggle multi-condition
dataset and ship it.** They evaluated at 0.96–0.99 macro-F1, which is not skill —
inspecting the images showed each condition folder has its own photographic style:
`pores` = macro skin patches on a black octagonal mask (not faces), `wrinkles` =
elderly outdoor stock portraits, `pigmentation` = tight studio half-face crops,
`Redness` = young indoor selfies. The classifier reads framing/age/background, never
the skin. That cue is absent on the app's real input (one camera, consistent
full-face framing), so predictions there are unreliable — and the 0.55 confidence
gate can't catch a confidently-wrong model.

Re-balancing negatives (70% same-source, commit `f650d44`) did NOT lower the scores:
the labels are confounded with photo style *inside* the dataset. Exports deleted from
`frontend/public/models/{redness,wrinkles,pores,pigmentation}/`, so the browser 404s
and the honest deterministic pixel-math analyzers keep those 4 dimensions. Pipeline +
staged data kept for experimentation only; warnings in `fetch_multi.py` and the
Makefile. **Trustworthy per-dimension models need the clinician grading loop on real
scans** (same camera/framing), not another public dataset.

**Shipping models (trustworthy):** acne eval macro-F1 **0.767** / ordinal MAE 0.254
(n=232 — bigger, harder test set than the earlier 0.817 at n=188, which had fewer
very-severe cases; val_macro_f1 rose 0.760→0.846); skintype **0.773** / acc 0.792.

### Mobile OOM + one multi-head model (2026-07-27, commits `b678655`, `e3eaef0`)

Phone showed Safari's "a problem repeatedly occurred" (an OOM tab kill, NOT a JS
error — console was clean), then hung on "Saving your scan…". Causes + fixes:

- Multi-angle decoding held all 5 angles at FULL resolution (~18-41MB). Crops are
  now scaled straight into a 224x224 canvas in one drawImage (~40x less memory,
  better resampling) and the ImageBitmap is closed. `MODEL_INPUT` in GuidedFaceFlow.
- face-parsing is ~85MB — skipped on memory-capped devices (`isMemoryConstrained()`
  in `segmentation/parser.ts`: deviceMemory<4, or iOS/iPadOS incl. the Mac-UA iPad).
  Those devices use landmark masks, which is what the 4s parse timeout already gave
  them. Force on with `VITE_FORCE_FACE_PARSING=1`.
- Refinement had no time bound → the save could hang. Now capped by
  `VITE_REFINE_TIMEOUT_MS` (20s); on timeout the deterministic report is saved.

**Architecture change — ONE model for the PWA** (`ai/training/multi/`): a single
shared EfficientNet-B0 trunk with a Linear head per task (acne 5-class + skintype
4-class). Each sample carries one task's label, loss is masked to that head, but
the trunk trains on all 5,725 rows (vs 1,621/4,104 in isolation) — fewer bytes AND
a regularizing effect. ONNX has one output per task (`logits_<task>`);
`ai/face/analyzers/face-model.ts` does ONE forward pass per view for everything,
views sequential so a phone never holds parallel inferences. Learned-analysis cost:
~30MB/10 passes → **~15MB/5 passes**. Adding a task = one entry in `multi/tasks.py`
TASKS (that's where redness/wrinkles/etc. belong once real labeled scans exist).

`make retrain-face` (train→eval→export). GuidedFaceFlow prefers `/models/face/` and
falls back to the old per-task acne/skintype models until it exists; once it does,
`frontend/public/models/{acne,skintype}/` are dead weight and can be deleted.

### Consistency, archive, lifecycle + analytics (2026-07-28)

Five features on top of the queue/governance stack:

- **Label Consistency Checker** (`shared/label-consistency.ts`). Compares a saved
  label against the patient's most recent APPROVED visit. Flags a jump of
  `LEVEL_JUMP = 2` severity levels inside `SHORT_PERIOD_DAYS = 30`. Skips
  `skintype` — it's categorical, so oily→dry is not a "jump". Advisory only: the
  reviewer sees a banner (Review again / Edit label / Approve anyway) and every
  warning is written to `scan_events` as kind `warning` for audit.
- **Image Lifecycle Tracking** (`shared/lifecycle.ts` + `scan_events` table). An
  append-only event log: captured → analyzed → reviewed/approved/rejected →
  dataset → trained, plus archived/restored/purged/warning. Timeline renders in
  the annotation panel; feed is `GET /api/training-queue/:scanId/events`.
- **Image Archive** (30-day retention). Deleting an angle now ARCHIVES it —
  `scan_images.archived_at` is stamped, and `listImages` excludes archived rows in
  both repo impls, so it vanishes from the scan but stays recoverable. Expiry is
  swept lazily on `GET /api/archive` (a clinic laptop isn't always on, so a timer
  would miss days). Restore + permanent delete under `/api/archive/...`.
- **Clinic Analytics** (`GET /api/analytics`): patients, visits, analyses, modal
  skin type + acne severity, mean confidence, mean review time, queue counts, plus
  dataset-growth and model-performance series. Charts are inline CSS bars — no
  chart library, no bundle weight. Lives at the top of the Training view.
- **Training Sandbox**: already satisfied by the existing candidate/production/
  archived model-release states + the deploy gate (`candidateBeatsProduction`), so
  no new surface was added — a candidate IS the isolated experiment.

Bug found and fixed while testing: `listImages` returned archived angles in both
`MemoryScanRepo` and `PgScanRepo`, so archiving would not have removed the image
from the scan. Postgres now filters `archived_at IS NULL`.

`npm run lint` fails repo-wide — there is no `eslint.config.js` (pre-existing,
unrelated to this work).

### Motion system + 3D zone map (2026-07-28)

Installed 19 skills (`.claude/skills/`, tracked in `skills-lock.json`): CloudAI-X
three.js ×10, GreenSock GSAP ×8, LottieFiles motion-design ×1. Note the GSAP repo
is `greensock/gsap-skills`. No Lottie *runtime* was added — that skill is motion
principles, not a player, so it costs no bundle.

**Brand motion identity** (`frontend/src/motion/tokens.ts`) — archetype Premium:
signature easing `cubic-bezier(0.32,0.72,0,1)` (already the CSS `ease-spring`),
durations quick 160 / standard 320 / slow 620ms, entrance = rise 16px + fade,
zero overshoot. `staggerFor(n)` clamps any cascade to the 500ms stagger budget.
Clinical rule on top: motion never delays or hides a result.

**`useReveal()`** (`frontend/src/motion/useReveal.ts`) — `useGSAP` with a scope
ref, `gsap.matchMedia()` for `prefers-reduced-motion`, animating *from* an offset
so content is never left invisible. Applied to FaceReportView + AnalyticsDashboard.

**3D zone map** (`FaceZoneMap3D.tsx`, behind `ZoneMap.tsx`) — a schematic head
painting per-zone severity from `report.dimensions[d].perZone`. Zones are declared
as `[yaw°, pitch°]` directions and *projected onto the head surface* rather than
hand-typed xyz; the first hand-typed version buried 2 of 7 markers inside the mesh
and made the eyes/mouth invisible. Positive yaw = the patient's LEFT = viewer's
right, matching a frontal photograph.

Guardrails, given the earlier iOS OOM: three.js is a `React.lazy` chunk
(135 kB gz) that never enters the main bundle and is only fetched when
`isMemoryConstrained()` is false AND WebGL exists — so iPhones/iPads never load
it. Pixel ratio capped at 2, rAF stopped via IntersectionObserver + visibility.
The zone bars are always rendered and are the source of truth; the head is a
garnish.

**Bundle cost, measured:** GSAP adds **+29.5 kB gz** to the main chunk
(123.6 → 153.1). three.js adds 0 to it. If that 29.5 kB is unwelcome, `useReveal`
is the only GSAP consumer and could be lazy-loaded or swapped for the existing
CSS `animate-rise`.

Test-env note: jsdom implements no `matchMedia`, which GSAP needs, so
`frontend/src/test/setup.ts` now polyfills it (reporting "no preference").

last Claude session: 2026-07-30 09:22
