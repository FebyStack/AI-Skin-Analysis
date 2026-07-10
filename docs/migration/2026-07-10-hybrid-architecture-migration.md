# Hybrid Architecture Migration — Log

Date: 2026-07-10 · Branch: `feat/hybrid-architecture` · Base: `a5920b5` (user checkpoint)
Commits: `ce5223b` (gitignore prep) → `5919abe` (stage 1) → `4dee881` (stage 2) → `c470423` (stage 3) → stage 4 (infra).

## Locked Spec (agreed before execution)

1. **Git safety** — checkpoint on `main`, migration on `feat/hybrid-architecture`.
2. **Classifier boundary** — pure inference code in `ai/classifier` + `ai/shared`; frontend keeps only the Web Worker wrapper/hooks and imports `ai/` at **build time**. Single documented exception to "Frontend → AI forbidden": inference runs in the browser by design (privacy: the second opinion never touches the network). No runtime Frontend→AI communication exists.
3. **Packages** — single root `package.json`; paths/aliases updated (no npm workspaces).
4. **Tests** — unit tests stay colocated; top-level `tests/` reserved for integration/e2e.

## Baseline (pre-migration)

- `tsc --noEmit` ✅ · `tsc -p server` ✅ · `vite build` ✅
- Tests: 38 files / 182 tests — **180 pass, 2 pre-existing failures** (not migration targets):
  - `ai/shared/verdict.test.ts` › "builds a classifier-only degraded verdict…" (summary wording vs `/partial/i`)
  - `frontend/…/use-quality-gate.test.ts` › "flags low resolution and bad aspect ratio" (missing `unsupported-aspect-ratio`)
- Incident: vitest 2.1.9 hung at startup (0% CPU) on Node 25.9.0 earlier today — sandboxed AND unsandboxed, forks AND threads pools. Resolved by the user (vitest config no longer loads `@vitejs/plugin-react`). Evidence: hang occurred after config bundling, pre-worker phase.

## File mapping (old → new)

### frontend/
| Old | New |
|---|---|
| `index.html`, `src/`, `public/` | `frontend/index.html`, `frontend/src/`, `frontend/public/` |
| `src/index.css` | `frontend/src/styles/index.css` |
| — | scaffold: `frontend/src/{components,layouts,services,hooks,providers,contexts,routes,assets,shared,utils,constants,types}` |

### shared/ (single sources of truth)
| Old | New |
|---|---|
| `server/analysis/contract.ts` ≡ `src/…/api/contract.ts` (byte-identical mirror, verified) | `shared/contract.ts` — mirror **deleted**, both sides import this |
| `server/analysis/contract.test.ts` | `shared/contract.test.ts` |
| `src/…/skin-analysis/types.ts` (+test) | `shared/types.ts` (+test); feature keeps a re-export barrel so historical import paths survive |

### ai/
| Old | New |
|---|---|
| `server/analysis/{pipeline,prompts,guardrails,critique}.ts` (+tests) | `ai/llm/` |
| `server/analysis/providers/{common,gemini}.ts` (+test) | `ai/llm/providers/` |
| `server/analysis/fixtures/golden-report.json` | `ai/evaluation/fixtures/` |
| `src/…/ml/{classifier,labels,worker-protocol}.ts` (+tests) | `ai/classifier/` |
| `src/…/ml/{quality,verdict,derived-views,annotate}.ts` (+tests) | `ai/shared/` |
| `generate_dummy_model.py` | `ai/training/` |
| — | `ai/models/README.md` (registry; browser-served ONNX stays in `frontend/public/models/` — browsers must fetch it), `ai/datasets/` |
| stays in frontend | `frontend/src/…/ml/classify.worker.ts` (runtime worker glue), hooks |

### backend/
| Old | New |
|---|---|
| `server/api/app.ts` | `backend/app/app.ts` (composition root mounting module routers; handler bodies byte-identical) |
| `server/api/index.ts`, `index-lite.ts` | `backend/server/` |
| `server/api/auth.ts` | `backend/modules/auth/service.ts` + `backend/middleware/require-session.ts` |
| login/status routes | `backend/modules/auth/routes.ts` |
| patient routes (incl. `/:id/scans`, consent) | `backend/modules/patients/routes.ts` |
| analyze/reanalyze/scan-image/scan-delete routes | `backend/modules/analysis/routes.ts` |
| capture-session routes | `backend/modules/capture/routes.ts` |
| `server/api/capture-sessions.ts` | `backend/modules/capture/store.ts` (in-memory pairing state — intentionally not a DB repository) |
| `repos.ts` + `pg-repos.ts` | split per module: `modules/{patients,analysis,settings}/repository.ts` (interface + Memory + Pg impls each); `isValidUuid` → `backend/shared/pg.ts` |
| `AppDeps` | `backend/shared/deps.ts` · `makeTestDeps` → `backend/shared/testing.ts` |
| `server/api/image.ts` | `backend/utils/image.ts` |
| `server/tsconfig.json` | `backend/tsconfig.json` |
| — | skeleton modules: `dashboard, reports, comparison, dataset, training` + `backend/config/` (env reading stays in the server entry, the composition root) |

### database/
| Old | New |
|---|---|
| `server/db/schema.sql` | `database/schema/schema.sql` |
| — | `database/{migrations,seeds}/` (skeletons; schema is self-applied idempotently on api boot — no migration tool in use) |
| `backup-*.sql` at root | `database/backups/` (Makefile target updated) |

### infrastructure/
| Old | New |
|---|---|
| `Dockerfile` | `infrastructure/docker/Dockerfile` (COPY paths updated) |
| `.dockerignore` | `infrastructure/docker/Dockerfile.dockerignore` (BuildKit per-Dockerfile ignore; `.venv` added) |
| `docker-compose{,.lan}.yml` | `infrastructure/docker/` — build context `../..`; **`name: skinanalysis` pinned** so the existing `skinanalysis_skin_data` volume keeps being used |
| `nginx.conf` | `infrastructure/docker/nginx.conf` |
| `Makefile` | stays at root; targets delegate with `-f infrastructure/docker/docker-compose.yml --env-file .env` |
| — | `infrastructure/{deployment,backup,restore,scripts}/` (skeletons) |

### tests/
Top-level `tests/` created (reserved for integration/e2e; unit tests colocated per locked spec).

## Config updates
- `tsconfig.json` — paths `@/*→frontend/src/*`, `@ai/*→ai/*`, `@shared/*→shared/*`; include `frontend/src, ai, shared`
- `vite.config.ts` — `root: "frontend"`, `build.outDir: "../dist"`, aliases `@ @ai @shared`
- `vitest.config.ts` — aliases + `setupFiles: frontend/src/test/setup.ts`
- `tailwind.config.js` — content globs → `frontend/…`
- `package.json` — `dev:server|dev:all|dev:lite|typecheck:server|build:server` → `backend/server/*`, `backend/tsconfig.json`
- `backend/server/index.ts` — schema read from `database/schema/schema.sql` **relative to cwd** (repo root in dev, `/app` in container)

## Behavior-preservation evidence
- API endpoint paths: unchanged (all `/api/*`; `/capture` proxy untouched)
- DB schema/volume: unchanged; compose project name pinned to keep existing data
- Auth, guardrails, pipeline, verdict logic: files moved, bodies unchanged
- Gates after EVERY stage: `tsc` ×2 green; tests **identical to baseline** (180 pass / same 2 pre-existing fails)
- ONNX serving URL `/models/skin-classifier.onnx` unchanged

## Deviations from the letter of the spec (with rationale)
1. Frontend build-time import of `ai/` (classifier) — approved exception (Locked Spec #2).
2. Modules contain only files with real content (`routes.ts` acts as controller at this size; `service.ts`/`repository.ts` where they exist) — per "each module should contain only the files that belong to that feature". No empty controller/validator/DTO stubs.
3. `Makefile` stays at root (make convention), delegating into `infrastructure/docker/`.
4. Browser-served ONNX artifacts remain under `frontend/public/models/` (browsers must fetch them); `ai/models/` documents management. Docker image now excludes `.onnx.data` too (previously only `.onnx` was excluded — the model was never usable in-container either way; "served out-of-band" per models README).
5. `backend/config/` is a skeleton — env reading intentionally stays in `backend/server/index*.ts` (the composition roots).

## Functional-verification scope note
The spec's checklist names features that do not exist in this codebase (Dashboard, Report PDF generation, Dataset Management/Import/Validation, Weekly Sunday Retraining Scheduler, Settings UI, comparison). Skeleton module folders were created for them; nothing to verify yet. Verified features: auth, patients API, camera capture, upload, AI analysis (classifier + LLM pipeline), report/results UI, scan history API, QR capture sessions, Docker deployment, backup/restore paths.

## Open items
- `hello.test.ts`, `test-db.js`, `vitest.min.config.ts` at repo root: user debugging leftovers committed in `a5920b5` — awaiting user decision (delete or keep).
- 2 pre-existing test failures (above) — in the user's WIP feature code, out of migration scope.
- `frontend/public/models/skin-classifier.onnx.data` (8.8 MB) is committed; `.gitignore` now excludes `*.onnx.data` for the future, but the tracked file stays tracked — user's call.
