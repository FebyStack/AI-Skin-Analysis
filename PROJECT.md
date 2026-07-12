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

- Node 25.9.0 (homebrew). 2026-07-10: vitest 2.1.9 hung at startup (0% CPU, forks+threads, sandboxed+unsandboxed) — resolved by dropping `@vitejs/plugin-react` from `vitest.config.ts`. If vitest hangs again, suspect that plugin/Node-25 interaction first.
- jsdom polyfills in `frontend/src/test/setup.ts` are load-bearing (broken localStorage, no Blob.text/Worker; `window` guard for node-env test files). Don't delete.
- `vite.config.ts` `worker.format: "es"` is required by onnxruntime-web.
- Docker: `Dockerfile.dockerignore` must exclude `.venv` (torch venv at repo root) and node_modules or `COPY . .` breaks native binaries; server bundle is CJS → `dist-server/index.cjs`; pg restore needs `--clean --if-exists` (schema self-applies on boot).
- Root debris awaiting Febriel's call: `hello.test.ts`, `test-db.js`, `vitest.min.config.ts` (vitest-hang debugging leftovers, committed in a5920b5); committed 8.8MB `frontend/public/models/skin-classifier.onnx.data`.

## Process (for continuity)

Brainstorm → spec → writing-plans → subagent-driven execution with one final opus review before merge. Verify camera/browser changes live in the preview tool, not just unit tests. `git push` to `https://github.com/FebyStack/AI-Skin-Analysis.git` was configured via `gh auth git-credential` but never confirmed pushed.

last Claude session: 2026-07-12 15:38

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
