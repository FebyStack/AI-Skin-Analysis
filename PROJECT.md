# AI Skin Analysis — Project Memory

Local clinic web app: patient skin scans (face + body), dual-AI analysis (on-device ONNX classifier + Claude vision + critique pass), stored locally in Postgres via Docker. Not public — one clinic, one laptop, portable via DB backup/restore. QR lets a phone act as a remote camera.

Spec: `docs/superpowers/specs/2026-07-03-ai-skin-analysis-design.md` (v2, Clinic Edition — supersedes an earlier public-web draft in git history).

## Plan status

| # | Plan | Folder | Status |
|---|---|---|---|
| 1 | Foundation & Capture | `plan-1-foundation-and-capture` | ✅ executed, merged to main |
| 2 | On-device ML (quality gate + classifier) | `plan-2-on-device-ml` | ✅ executed, merged to main |
| 3 | LLM Analysis Engine (`server/analysis/*`) | `plan-3-llm-analysis-service` | ✅ executed, merged to main |
| 4 | Docker Clinic Stack (Express api + Postgres + compose) | `plan-4-docker-clinic-stack` | ✅ executed, merged to main |
| 5 | Results & Report UI (verdict merge, loading screen, report, derived views) | `plan-5-results-report-ui` | 📝 drafted, not executed |
| 6 | Patients, History & QR UI | `plan-6-patients-history-qr` | 📝 drafted, not executed |

**Next step: execute Plan 5, then Plan 6** (subagent-driven, isolated worktree per plan — see pattern below).

## Current repo state (as of last session)

- Branch: `main` only, clean working tree, HEAD `3276019` ("Merge branch 'feat/clinic-stack'").
- All of Plans 1–4 are merged and passing (`npm run verify`: typecheck + typecheck:server + tests + build). Test count ~136 at Plan 4 merge.
- No GitHub remote pushed yet — `origin` is set to `https://github.com/FebyStack/AI-Skin-Analysis.git` (empty repo), but the push hasn't completed (see below).
- `.gitignore` is hardened: `.env`/`.env.*` (keeps `.env.example`), `*.pem`/`*.key`/`secrets/`, `backup-*.sql`/`*.dump`/`data/`, `dist-server/`, `*.onnx`, `.worktrees/`. Verified no live secrets tracked.

## Open thread: GitHub push

`git push -u origin main` hung on an HTTPS credential prompt (non-interactive shell, no stored credential). Fix already applied locally: `git config --local credential.helper "!gh auth git-credential"` (uses the existing `gh auth` login as FebyStack). **The push itself has not been retried/confirmed yet** — do this first in the next session if the user wants it on GitHub.

## Architecture (why, not just what)

- **Client-heavy, server-thin.** Camera, quality gate (MediaPipe-style checks), and ONNX classifier all run in the browser (a Web Worker) — the "independent second opinion" never touches the network. Only the Claude vision call leaves the device.
- **`server/analysis/*` is pure and HTTP-free** — every module (contract, prompts, guardrails, provider adapter, critique, pipeline) is plain TypeScript, unit-tested with fakes, no Express/Deno/Postgres imports. `server/api/*` is the thin Express layer that wires them to Postgres — this split is why Plan 3 could be written once and reused almost unchanged when the target moved from a public Supabase Edge Function to a local Node container mid-project (see "pivot" below).
- **Guardrail chain (safety-critical, do not weaken):** LLM output must pass `checkOutputGuardrails` — no diagnosis/benign/malignant/prescription language, mandatory non-diagnosis disclaimer, professional referral required whenever any finding is `attention` severity. Verified in review: an amended (critique-corrected) report is re-scanned by the same guardrail, so critique can't launder unsafe language through.
- **Verdict merge is the highest-stakes pure logic** (`ml/verdict.ts`, Plan 5): combines classifier + LLM findings, escalates to `attention` if *either* source flags it (safety override — never averaged down), combined confidence via `1-(1-a)(1-b)` when both agree.
- **Deep-analysis features are "camera edition," not simulated hardware.** Two professional analyzer devices were used as feature benchmarks (GZ Beauty MLB-E02 → the 12 report dimensions; ISEMECO 2D S7 → the derived pigmentation/redness/texture views). Rule that must survive any future revision: we compute real pixel-math derivations from the one RGB photo and label them as such — we never fabricate a fake UV/IR/3D image and present it as real. Medical guardrails (no diagnosis, no malignancy calls) are separate and never negotiable.
- **QR remote capture**: a single-use, ~5-minute token lets a phone act as a second camera for the desktop scan flow — no login on the phone side, upload-only, token is the entire authorization.
- **Local-first storage**: Postgres in a named Docker volume; images stored as JPEG (sharp: downscale to ≤1280px long edge, quality 80, EXIF stripped via `.rotate()` + re-encode) directly in a `bytea` column alongside the JSONB report. `make backup`/`make restore` (pg_dump/psql) is the entire "move to another laptop" story — verified working against both a live DB and a fresh volume.

## Key deviations found during execution (all fixed, all in build/infra, none in app logic)

- Vitest was picking up duplicate tests inside `.worktrees/` — excluded in `vitest.config.ts`.
- jsdom in this environment ships broken `localStorage` and no `Blob.text()`/`Worker` — guarded polyfills live in `src/test/setup.ts`; don't remove them thinking they're dead code.
- Vite's default IIFE worker format can't code-split, which onnxruntime-web needs — `vite.config.ts` sets `worker: { format: "es" }`.
- `@types/node` was missing from the initial scaffold, silently breaking `tsc -b` (but not `tsc --noEmit`) — now pinned.
- Docker: needed an explicit `.dockerignore` (without one, `COPY . .` overwrote container-installed native binaries for sharp/esbuild with host macOS binaries); server bundle is named `dist-server/index.cjs` (not `.js`) because root `package.json` has `"type": "module"` but the bundle is CJS; `pg_dump`/restore needs `--clean --if-exists` because the api self-applies `schema.sql` on every boot (a plain restore into an already-migrated DB throws "relation exists").

## How this project has been built (process, for continuity)

Brainstorm → written spec → `writing-plans` → **subagent-driven-development**, one plan at a time: dispatch a fresh isolated-worktree subagent to execute all tasks in a plan (TDD, commit per task), then a separate `model: opus` final-review subagent audits the whole branch diff before I merge to `main` and clean up the worktree/branch. This has caught real bugs each time (camera stream leaks, EXIF-orientation bugs, silent upload failures, a broken jsdom localStorage, the Docker packaging issues above) — don't skip the final review step even though it's slower.

Camera/browser-observable changes were verified live via the preview tool, not just by unit tests, before being called done (e.g. the camera-retry-affordance fix).

## Where to look

- Full requirements: `docs/superpowers/specs/2026-07-03-ai-skin-analysis-design.md`
- Next work: `docs/superpowers/plans/plan-5-results-report-ui/` then `plan-6-patients-history-qr/`
- Run tests: `npm run verify` (or `npx vitest run` for just tests)
- Local stack: `docker compose up` / `make up`, `.env` from `.env.example` (needs `ANTHROPIC_API_KEY` for real analyses; blank key still runs but produces partial-only scans)

last Claude session: 2026-07-10 09:37
