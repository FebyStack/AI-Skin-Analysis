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

### Capture guide: golden-ratio phi mask (2026-07-30)

The oval capture guide is now the Marquardt phi mask, enlarged to 78% of frame
height. `capture/phi-mask.ts` is the single source: polylines in the reference
drawing's pixel space, symmetric parts authored as a RIGHT half and mirrored.
Feeds the SVG scrim/silhouette/progress AND (originally) a WebGL wireframe.

Per-step poses come from the midpoint of `ANGLE_YAW_WINDOWS`, so the guide and
the validator cannot disagree. Sign note: the window is measured on the RAW
frame (patient's left = image-right, hence negative), the preview is CSS-mirrored,
and a negative Y-rotation swings the nose screen-left — two flips that cancel.

`SILHOUETTE_YAW_RATIO = 0.35`: at profile yaw the framing outline would
foreshorten to a sliver, telling the patient to squeeze their head into a narrow
band. A real head stays head-width at any yaw; only the FACE compresses.

**Then: the WebGL layer was deleted.** It was gated behind `isMemoryConstrained()`,
true for every iPhone — so the clinic's own phones saw a bare outline. SVG now
draws the entire construction (`maskPaths()`) on every device. SVG was always
right here: this sits over a live camera feed while MediaPipe runs.

### Private scan links (2026-07-30)

Remote patients get a link that runs the scan flow and nothing else.
`make share` = Cloudflare quick tunnel, wrapped in `caffeinate -ism` because this
Mac idles to sleep in ~1 minute. Vite 5.4+ rejects unknown Hosts, so tunnel
hostnames are in `server.allowedHosts`. Closing the LID still kills it — not
fixable in software on a laptop.

Invites (`shared/invites.ts`, `backend/modules/invites/`):
- Token = 32 random bytes, returned ONCE at creation.
- Session tokens carry a role: `v2.<exp>.invite.<id>.<claimId>.<sig>`. Legacy
  two-part clinic tokens still validate.
- `requireClinician` gates patients/lesion/capture/training/queue/governance/
  archive/analytics. Only face-scan routes accept an invite.
- **Single-device binding**: first browser to open CLAIMS the link (atomic
  `UPDATE ... WHERE claimed_at IS NULL`); the claim secret lives in that device's
  session. A forwarded link gets 409. Stops forwarding, NOT handing over a phone.
- Two clocks: 15 min to OPEN, then 60 min to finish. One clock would cut a scan
  off mid-flow.
- Quota spent in one atomic UPDATE before anything persists.
- `scans.invite_id` scopes reads; mismatch is 404, not 403, so ids cannot be probed.

Gap audit found five things, all fixed: a 403 was queued as if it were an outage
(the patient was told "saved, will sync later" about a scan that could never
sync); no rate limiting on `/api/auth/login` with the app on a public URL; the
redemption promise cached globally rather than per token; refused patients landed
on the CLINICIAN password prompt; and Revoke was hidden for unopened links.

**Logout never logged anyone out** — it assigned to `document.cookie`, which
cannot clear an HttpOnly cookie. Now `POST /api/auth/logout`. Pre-existing.

### Obsidian orb + one loading treatment (2026-07-31)

`ui/ObsidianOrb.tsx` — faceted icosahedron, flat-shaded, gold motes. No HDR env
map: it mounts at the most memory-pressured moment in the app. Gloss comes from
four moderate lights (one bright key blows out a single facet) plus a close
PointLight for the travelling specular. Quality is TIERED, not gated.

`ui/LoadingState.tsx` is the single waiting treatment: `page` = the orb, `inline`
= a CSS ping. The split is forced — every orb is a live WebGL context, browsers
cap them, and the Training tab mounts four loading sections at once. Queue and
History keep skeletons, which preview real row layout.

### THE black screen: hooks-order violation (2026-07-31)

`GuidedFaceFlow` renders five views via early returns, and `useEasedYaw` + the
mask `useMemo` sat BELOW them. They ran on the capture render and were skipped
the instant `view` flipped → "Rendered fewer hooks than expected" → React
unmounted the tree. Present since the phi-mask commit.

Fixed by moving the whole per-step block above every early return.
`capture/hooks-order.test.tsx` parses the file and fails if any `use*(` appears
after the first early return — verified it fails when a hook is moved back down.

**Correction:** I earlier blamed this on `localReport` being read from the server
echo, and on a failed lazy chunk. Both were real latent bugs and those fixes
stand, but neither was the cause. `Boundary` + a visible error message is what
found it — `components/ui/Boundary.tsx` catches render AND chunk failures, and
its fallback can be a function receiving `{ message, where }`.

### Dimension provenance: the "100%" was zone coverage (2026-07-31)

The panel showed **Wrinkles: None · 100%** on a visibly wrinkled face. In
`analyzers/types.ts`, `confidence = collected.size / zones.length` — how much of
the face was VISIBLE, not certainty. With 5 angles it is always 1.0, rendered in
the same green badge as real model probabilities.

The report advertises 11 dimensions; the model trains 2. The other 9 are pixel
heuristics with hand-picked constants (`HF_BASE = 0.008`, `HF_SPAN = 0.05`).

`DimensionScore.source: "model" | "heuristic"` (optional → old reports are
heuristic). `MODELLED_DIMENSIONS` / `isModelled()` are the single source of
truth. The badge shows a neutral **"estimate"**; the patient report says "Visual
estimate — not a trained measurement".

### All 11 dimensions gradeable + trainable (2026-07-31)

`dryness`, `under-eye`, `tone-consistency` added to `ANNOTATION_FIELDS` (labelled
"Under-Eye Shadowing" / "Tone Unevenness" — every score runs 0..1 as MORE
pronounced). `ai/training/dimension/` gives a generic severity ingest; TASKS is
data-driven via `build_tasks()`, a dimension joining once every class has
`MIN_PER_CLASS = 40`. `make dimension-readiness` shows the gap.

**Landmine defused:** the first generic ingest read every source folder and
reported redness/pigmentation/pores/wrinkles at 600-1200 rows. Those were
leftover `<dim>/multi/absent/` folders holding Roboflow ACNE photos — 497
identical images reused as the "none" class for four dimensions at once. That is
the 2026-07-27 leakage, resurrected. Severity dimensions now read ONLY
clinic-graded `scans/`; opt in with `DIMENSION_EXTRA_SOURCES`.

Browser now reads model outputs by NAME (`logits_<task>`), not index — adding a
head shifted positions and would have fed skintype logits into acne.

### External datasets (2026-07-31)

`make fetch-dimension-datasets` → 133 images / 293 MB in `$DATASETS_DIR/_incoming`
(gitignored, and the trainer does not read it). Two TrainingDataPro sets: 10
subjects x 3 angles for acne/redness/under-eye bags, plus 23 botox before/after
pairs. One publisher, one rig, angles matching the app.

**No public dataset grades these on a severity scale** — all presence/absence.
Rejected: `rishantrokaha/skin-wrinkles-vs-nonwrinkles` (9-23 KB, wrinkled=press
photos of older people vs smooth=young selfies → learns style/age); three
Roboflow re-exports of the leaking corpus; `glowmix` (4 GB, "merged").

`make import-for-grading` loads them into the queue as an "Imported dataset"
patient with `report: null` — inventing predictions to "verify" would bias the
labels. NOT run automatically: it writes 75 scans to the live DB.

Full write-up: `docs/DIMENSION-COVERAGE.md`.

**PROCESS NOTE:** several PROJECT.md updates between 2026-07-28 and 2026-07-31
silently failed — they anchored on a `last Claude session:` timestamp that had
already drifted, so the replace matched nothing and the sections were never
written while being reported as done. Append, then VERIFY the section landed.

### Severity scale → presence (2026-07-31)

The 9 non-acne dimensions now grade `absent` / `present`, not
none/mild/moderate/severe. Reasons, in order of weight:

1. **Untrainable as it stood.** Months of grading yielded 43 none / 23 mild /
   4 moderate / **0 severe**. Four classes cannot be fitted from that; the same
   labels are a usable 43/27 split as presence.
2. **No dataset grades by degree.** Every public corpus is presence/absence, so
   the scale could never be grounded externally either.
3. **Not reproducible.** "Mild vs moderate" is a judgement two clinicians
   disagree on; "is it visibly present?" is not.
4. Degree is still communicated — by the model's probability.

`PRESENCE_LEVELS` replaces `SEVERITY_LEVELS`; `scoreToPresence` replaces
`scoreToSeverity`; Python gets `PRESENCE_CLASSES` / `normalize_presence`.
acne keeps its 5 levels (it has real graded data) and skintype its 4 categories.
`MIN_PER_CLASS = 40` now means 80 images per dimension, not 160.

**Nothing stored was rewritten.** Old labels map forward on READ
(`normalizePresence`, `normalize_presence`), so previously exported folders
(`<dim>/scans/mild/`) still train and no clinician grade is lost.

Two things this surfaced:
- `LEVEL_JUMP = 2` in the consistency checker can never fire on a 2-option
  scale — max jump is 1. `jumpThreshold()` now adapts, so a presence FLIP is
  what gets questioned.
- Normalising in `levelIndex` initially applied to every field, turning acne's
  "moderate" into "present" — not one of acne's options, silently switching the
  check off for acne. Direct match is tried first now.



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

### Capture guide: golden-ratio phi mask (2026-07-30)

The oval capture guide is now the Marquardt phi mask, enlarged to 78% of frame
height. `capture/phi-mask.ts` is the single source: polylines in the reference
drawing's pixel space, symmetric parts authored as a RIGHT half and mirrored.
Feeds the SVG scrim/silhouette/progress AND (originally) a WebGL wireframe.

Per-step poses come from the midpoint of `ANGLE_YAW_WINDOWS`, so the guide and
the validator cannot disagree. Sign note: the window is measured on the RAW
frame (patient's left = image-right, hence negative), the preview is CSS-mirrored,
and a negative Y-rotation swings the nose screen-left — two flips that cancel.

`SILHOUETTE_YAW_RATIO = 0.35`: at profile yaw the framing outline would
foreshorten to a sliver, telling the patient to squeeze their head into a narrow
band. A real head stays head-width at any yaw; only the FACE compresses.

**Then: the WebGL layer was deleted.** It was gated behind `isMemoryConstrained()`,
true for every iPhone — so the clinic's own phones saw a bare outline. SVG now
draws the entire construction (`maskPaths()`) on every device. SVG was always
right here: this sits over a live camera feed while MediaPipe runs.

### Private scan links (2026-07-30)

Remote patients get a link that runs the scan flow and nothing else.
`make share` = Cloudflare quick tunnel, wrapped in `caffeinate -ism` because this
Mac idles to sleep in ~1 minute. Vite 5.4+ rejects unknown Hosts, so tunnel
hostnames are in `server.allowedHosts`. Closing the LID still kills it — not
fixable in software on a laptop.

Invites (`shared/invites.ts`, `backend/modules/invites/`):
- Token = 32 random bytes, returned ONCE at creation.
- Session tokens carry a role: `v2.<exp>.invite.<id>.<claimId>.<sig>`. Legacy
  two-part clinic tokens still validate.
- `requireClinician` gates patients/lesion/capture/training/queue/governance/
  archive/analytics. Only face-scan routes accept an invite.
- **Single-device binding**: first browser to open CLAIMS the link (atomic
  `UPDATE ... WHERE claimed_at IS NULL`); the claim secret lives in that device's
  session. A forwarded link gets 409. Stops forwarding, NOT handing over a phone.
- Two clocks: 15 min to OPEN, then 60 min to finish. One clock would cut a scan
  off mid-flow.
- Quota spent in one atomic UPDATE before anything persists.
- `scans.invite_id` scopes reads; mismatch is 404, not 403, so ids cannot be probed.

Gap audit found five things, all fixed: a 403 was queued as if it were an outage
(the patient was told "saved, will sync later" about a scan that could never
sync); no rate limiting on `/api/auth/login` with the app on a public URL; the
redemption promise cached globally rather than per token; refused patients landed
on the CLINICIAN password prompt; and Revoke was hidden for unopened links.

**Logout never logged anyone out** — it assigned to `document.cookie`, which
cannot clear an HttpOnly cookie. Now `POST /api/auth/logout`. Pre-existing.

### Obsidian orb + one loading treatment (2026-07-31)

`ui/ObsidianOrb.tsx` — faceted icosahedron, flat-shaded, gold motes. No HDR env
map: it mounts at the most memory-pressured moment in the app. Gloss comes from
four moderate lights (one bright key blows out a single facet) plus a close
PointLight for the travelling specular. Quality is TIERED, not gated.

`ui/LoadingState.tsx` is the single waiting treatment: `page` = the orb, `inline`
= a CSS ping. The split is forced — every orb is a live WebGL context, browsers
cap them, and the Training tab mounts four loading sections at once. Queue and
History keep skeletons, which preview real row layout.

### THE black screen: hooks-order violation (2026-07-31)

`GuidedFaceFlow` renders five views via early returns, and `useEasedYaw` + the
mask `useMemo` sat BELOW them. They ran on the capture render and were skipped
the instant `view` flipped → "Rendered fewer hooks than expected" → React
unmounted the tree. Present since the phi-mask commit.

Fixed by moving the whole per-step block above every early return.
`capture/hooks-order.test.tsx` parses the file and fails if any `use*(` appears
after the first early return — verified it fails when a hook is moved back down.

**Correction:** I earlier blamed this on `localReport` being read from the server
echo, and on a failed lazy chunk. Both were real latent bugs and those fixes
stand, but neither was the cause. `Boundary` + a visible error message is what
found it — `components/ui/Boundary.tsx` catches render AND chunk failures, and
its fallback can be a function receiving `{ message, where }`.

### Dimension provenance: the "100%" was zone coverage (2026-07-31)

The panel showed **Wrinkles: None · 100%** on a visibly wrinkled face. In
`analyzers/types.ts`, `confidence = collected.size / zones.length` — how much of
the face was VISIBLE, not certainty. With 5 angles it is always 1.0, rendered in
the same green badge as real model probabilities.

The report advertises 11 dimensions; the model trains 2. The other 9 are pixel
heuristics with hand-picked constants (`HF_BASE = 0.008`, `HF_SPAN = 0.05`).

`DimensionScore.source: "model" | "heuristic"` (optional → old reports are
heuristic). `MODELLED_DIMENSIONS` / `isModelled()` are the single source of
truth. The badge shows a neutral **"estimate"**; the patient report says "Visual
estimate — not a trained measurement".

### All 11 dimensions gradeable + trainable (2026-07-31)

`dryness`, `under-eye`, `tone-consistency` added to `ANNOTATION_FIELDS` (labelled
"Under-Eye Shadowing" / "Tone Unevenness" — every score runs 0..1 as MORE
pronounced). `ai/training/dimension/` gives a generic severity ingest; TASKS is
data-driven via `build_tasks()`, a dimension joining once every class has
`MIN_PER_CLASS = 40`. `make dimension-readiness` shows the gap.

**Landmine defused:** the first generic ingest read every source folder and
reported redness/pigmentation/pores/wrinkles at 600-1200 rows. Those were
leftover `<dim>/multi/absent/` folders holding Roboflow ACNE photos — 497
identical images reused as the "none" class for four dimensions at once. That is
the 2026-07-27 leakage, resurrected. Severity dimensions now read ONLY
clinic-graded `scans/`; opt in with `DIMENSION_EXTRA_SOURCES`.

Browser now reads model outputs by NAME (`logits_<task>`), not index — adding a
head shifted positions and would have fed skintype logits into acne.

### External datasets (2026-07-31)

`make fetch-dimension-datasets` → 133 images / 293 MB in `$DATASETS_DIR/_incoming`
(gitignored, and the trainer does not read it). Two TrainingDataPro sets: 10
subjects x 3 angles for acne/redness/under-eye bags, plus 23 botox before/after
pairs. One publisher, one rig, angles matching the app.

**No public dataset grades these on a severity scale** — all presence/absence.
Rejected: `rishantrokaha/skin-wrinkles-vs-nonwrinkles` (9-23 KB, wrinkled=press
photos of older people vs smooth=young selfies → learns style/age); three
Roboflow re-exports of the leaking corpus; `glowmix` (4 GB, "merged").

`make import-for-grading` loads them into the queue as an "Imported dataset"
patient with `report: null` — inventing predictions to "verify" would bias the
labels. NOT run automatically: it writes 75 scans to the live DB.

Full write-up: `docs/DIMENSION-COVERAGE.md`.

**PROCESS NOTE:** several PROJECT.md updates between 2026-07-28 and 2026-07-31
silently failed — they anchored on a `last Claude session:` timestamp that had
already drifted, so the replace matched nothing and the sections were never
written while being reported as done. Append, then VERIFY the section landed.

### Severity scale → presence (2026-07-31)

The 9 non-acne dimensions now grade `absent` / `present`, not
none/mild/moderate/severe. Reasons, in order of weight:

1. **Untrainable as it stood.** Months of grading yielded 43 none / 23 mild /
   4 moderate / **0 severe**. Four classes cannot be fitted from that; the same
   labels are a usable 43/27 split as presence.
2. **No dataset grades by degree.** Every public corpus is presence/absence, so
   the scale could never be grounded externally either.
3. **Not reproducible.** "Mild vs moderate" is a judgement two clinicians
   disagree on; "is it visibly present?" is not.
4. Degree is still communicated — by the model's probability.

`PRESENCE_LEVELS` replaces `SEVERITY_LEVELS`; `scoreToPresence` replaces
`scoreToSeverity`; Python gets `PRESENCE_CLASSES` / `normalize_presence`.
acne keeps its 5 levels (it has real graded data) and skintype its 4 categories.
`MIN_PER_CLASS = 40` now means 80 images per dimension, not 160.

**Nothing stored was rewritten.** Old labels map forward on READ
(`normalizePresence`, `normalize_presence`), so previously exported folders
(`<dim>/scans/mild/`) still train and no clinician grade is lost.

Two things this surfaced:
- `LEVEL_JUMP = 2` in the consistency checker can never fire on a 2-option
  scale — max jump is 1. `jumpThreshold()` now adapts, so a presence FLIP is
  what gets questioned.
- Normalising in `levelIndex` initially applied to every field, turning acne's
  "moderate" into "present" — not one of acne's options, silently switching the
  check off for acne. Direct match is tried first now.



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

### Capture guide: golden-ratio phi mask (2026-07-30)

The oval capture guide is now the Marquardt phi mask, enlarged to 78% of frame
height. `capture/phi-mask.ts` is the single source: polylines in the reference
drawing's pixel space, symmetric parts authored as a RIGHT half and mirrored.
Feeds the SVG scrim/silhouette/progress AND (originally) a WebGL wireframe.

Per-step poses come from the midpoint of `ANGLE_YAW_WINDOWS`, so the guide and
the validator cannot disagree. Sign note: the window is measured on the RAW
frame (patient's left = image-right, hence negative), the preview is CSS-mirrored,
and a negative Y-rotation swings the nose screen-left — two flips that cancel.

`SILHOUETTE_YAW_RATIO = 0.35`: at profile yaw the framing outline would
foreshorten to a sliver, telling the patient to squeeze their head into a narrow
band. A real head stays head-width at any yaw; only the FACE compresses.

**Then: the WebGL layer was deleted.** It was gated behind `isMemoryConstrained()`,
true for every iPhone — so the clinic's own phones saw a bare outline. SVG now
draws the entire construction (`maskPaths()`) on every device. SVG was always
right here: this sits over a live camera feed while MediaPipe runs.

### Private scan links (2026-07-30)

Remote patients get a link that runs the scan flow and nothing else.
`make share` = Cloudflare quick tunnel, wrapped in `caffeinate -ism` because this
Mac idles to sleep in ~1 minute. Vite 5.4+ rejects unknown Hosts, so tunnel
hostnames are in `server.allowedHosts`. Closing the LID still kills it — not
fixable in software on a laptop.

Invites (`shared/invites.ts`, `backend/modules/invites/`):
- Token = 32 random bytes, returned ONCE at creation.
- Session tokens carry a role: `v2.<exp>.invite.<id>.<claimId>.<sig>`. Legacy
  two-part clinic tokens still validate.
- `requireClinician` gates patients/lesion/capture/training/queue/governance/
  archive/analytics. Only face-scan routes accept an invite.
- **Single-device binding**: first browser to open CLAIMS the link (atomic
  `UPDATE ... WHERE claimed_at IS NULL`); the claim secret lives in that device's
  session. A forwarded link gets 409. Stops forwarding, NOT handing over a phone.
- Two clocks: 15 min to OPEN, then 60 min to finish. One clock would cut a scan
  off mid-flow.
- Quota spent in one atomic UPDATE before anything persists.
- `scans.invite_id` scopes reads; mismatch is 404, not 403, so ids cannot be probed.

Gap audit found five things, all fixed: a 403 was queued as if it were an outage
(the patient was told "saved, will sync later" about a scan that could never
sync); no rate limiting on `/api/auth/login` with the app on a public URL; the
redemption promise cached globally rather than per token; refused patients landed
on the CLINICIAN password prompt; and Revoke was hidden for unopened links.

**Logout never logged anyone out** — it assigned to `document.cookie`, which
cannot clear an HttpOnly cookie. Now `POST /api/auth/logout`. Pre-existing.

### Obsidian orb + one loading treatment (2026-07-31)

`ui/ObsidianOrb.tsx` — faceted icosahedron, flat-shaded, gold motes. No HDR env
map: it mounts at the most memory-pressured moment in the app. Gloss comes from
four moderate lights (one bright key blows out a single facet) plus a close
PointLight for the travelling specular. Quality is TIERED, not gated.

`ui/LoadingState.tsx` is the single waiting treatment: `page` = the orb, `inline`
= a CSS ping. The split is forced — every orb is a live WebGL context, browsers
cap them, and the Training tab mounts four loading sections at once. Queue and
History keep skeletons, which preview real row layout.

### THE black screen: hooks-order violation (2026-07-31)

`GuidedFaceFlow` renders five views via early returns, and `useEasedYaw` + the
mask `useMemo` sat BELOW them. They ran on the capture render and were skipped
the instant `view` flipped → "Rendered fewer hooks than expected" → React
unmounted the tree. Present since the phi-mask commit.

Fixed by moving the whole per-step block above every early return.
`capture/hooks-order.test.tsx` parses the file and fails if any `use*(` appears
after the first early return — verified it fails when a hook is moved back down.

**Correction:** I earlier blamed this on `localReport` being read from the server
echo, and on a failed lazy chunk. Both were real latent bugs and those fixes
stand, but neither was the cause. `Boundary` + a visible error message is what
found it — `components/ui/Boundary.tsx` catches render AND chunk failures, and
its fallback can be a function receiving `{ message, where }`.

### Dimension provenance: the "100%" was zone coverage (2026-07-31)

The panel showed **Wrinkles: None · 100%** on a visibly wrinkled face. In
`analyzers/types.ts`, `confidence = collected.size / zones.length` — how much of
the face was VISIBLE, not certainty. With 5 angles it is always 1.0, rendered in
the same green badge as real model probabilities.

The report advertises 11 dimensions; the model trains 2. The other 9 are pixel
heuristics with hand-picked constants (`HF_BASE = 0.008`, `HF_SPAN = 0.05`).

`DimensionScore.source: "model" | "heuristic"` (optional → old reports are
heuristic). `MODELLED_DIMENSIONS` / `isModelled()` are the single source of
truth. The badge shows a neutral **"estimate"**; the patient report says "Visual
estimate — not a trained measurement".

### All 11 dimensions gradeable + trainable (2026-07-31)

`dryness`, `under-eye`, `tone-consistency` added to `ANNOTATION_FIELDS` (labelled
"Under-Eye Shadowing" / "Tone Unevenness" — every score runs 0..1 as MORE
pronounced). `ai/training/dimension/` gives a generic severity ingest; TASKS is
data-driven via `build_tasks()`, a dimension joining once every class has
`MIN_PER_CLASS = 40`. `make dimension-readiness` shows the gap.

**Landmine defused:** the first generic ingest read every source folder and
reported redness/pigmentation/pores/wrinkles at 600-1200 rows. Those were
leftover `<dim>/multi/absent/` folders holding Roboflow ACNE photos — 497
identical images reused as the "none" class for four dimensions at once. That is
the 2026-07-27 leakage, resurrected. Severity dimensions now read ONLY
clinic-graded `scans/`; opt in with `DIMENSION_EXTRA_SOURCES`.

Browser now reads model outputs by NAME (`logits_<task>`), not index — adding a
head shifted positions and would have fed skintype logits into acne.

### External datasets (2026-07-31)

`make fetch-dimension-datasets` → 133 images / 293 MB in `$DATASETS_DIR/_incoming`
(gitignored, and the trainer does not read it). Two TrainingDataPro sets: 10
subjects x 3 angles for acne/redness/under-eye bags, plus 23 botox before/after
pairs. One publisher, one rig, angles matching the app.

**No public dataset grades these on a severity scale** — all presence/absence.
Rejected: `rishantrokaha/skin-wrinkles-vs-nonwrinkles` (9-23 KB, wrinkled=press
photos of older people vs smooth=young selfies → learns style/age); three
Roboflow re-exports of the leaking corpus; `glowmix` (4 GB, "merged").

`make import-for-grading` loads them into the queue as an "Imported dataset"
patient with `report: null` — inventing predictions to "verify" would bias the
labels. NOT run automatically: it writes 75 scans to the live DB.

Full write-up: `docs/DIMENSION-COVERAGE.md`.

**PROCESS NOTE:** several PROJECT.md updates between 2026-07-28 and 2026-07-31
silently failed — they anchored on a `last Claude session:` timestamp that had
already drifted, so the replace matched nothing and the sections were never
written while being reported as done. Append, then VERIFY the section landed.

### Severity scale → presence (2026-07-31)

The 9 non-acne dimensions now grade `absent` / `present`, not
none/mild/moderate/severe. Reasons, in order of weight:

1. **Untrainable as it stood.** Months of grading yielded 43 none / 23 mild /
   4 moderate / **0 severe**. Four classes cannot be fitted from that; the same
   labels are a usable 43/27 split as presence.
2. **No dataset grades by degree.** Every public corpus is presence/absence, so
   the scale could never be grounded externally either.
3. **Not reproducible.** "Mild vs moderate" is a judgement two clinicians
   disagree on; "is it visibly present?" is not.
4. Degree is still communicated — by the model's probability.

`PRESENCE_LEVELS` replaces `SEVERITY_LEVELS`; `scoreToPresence` replaces
`scoreToSeverity`; Python gets `PRESENCE_CLASSES` / `normalize_presence`.
acne keeps its 5 levels (it has real graded data) and skintype its 4 categories.
`MIN_PER_CLASS = 40` now means 80 images per dimension, not 160.

**Nothing stored was rewritten.** Old labels map forward on READ
(`normalizePresence`, `normalize_presence`), so previously exported folders
(`<dim>/scans/mild/`) still train and no clinician grade is lost.

Two things this surfaced:
- `LEVEL_JUMP = 2` in the consistency checker can never fire on a 2-option
  scale — max jump is 1. `jumpThreshold()` now adapts, so a presence FLIP is
  what gets questioned.
- Normalising in `levelIndex` initially applied to every field, turning acne's
  "moderate" into "present" — not one of acne's options, silently switching the
  check off for acne. Direct match is tried first now.



## 2026-07-31 — AI-annotator labelling pipeline (skill + agent + materializer)

Labelling the 11.3k unlabelled corpus is now agent-driven:

- `.claude/skills/face-labelling/SKILL.md` — operational rubric (exact vocab,
  quality gate, omit-don't-guess, no cross-attribute inference, no folder-name
  labels). Written TDD-style: baseline agent without it used invalid vocab
  (`mild` on binary dims), defaulted unassessable attrs to "none", skipped the
  quality gate; the skill counters each observed failure.
- `.claude/agents/face-labeller.md` — batch annotator subagent (manifest of
  image paths + output JSONL). Loads next session.
- `ai/training/dimension/materialize.py` — validates JSONL (loud per-line
  rejects, no alias forgiveness) and hardlinks confident quality-ok labels into
  `$DATASETS_DIR/<attr>/auto/<label>/`. `uncertain` attrs skipped; `auto`
  source inert until `DIMENSION_EXTRA_SOURCES=auto`, so clinic `scans/` remain
  the held-out truth. Tests: `ai/training/tests/test_materialize.py` (6).
- Known-broken pre-existing: `ai/training/dimension/tests/test_ingest.py`
  imports the deleted severity API — spawned as a follow-up chip.

Run a batch: dispatch `face-labeller` with paths + JSONL out, then
`.venv/bin/python -m ai.training.dimension.materialize <batch>.jsonl`.
last Claude session: 2026-08-07 16:48

### 2026-08-01 — two bugs found before the first materialize

Both would have corrupted training silently, and both are now covered by tests:

1. **Basename collisions.** 1136 basenames repeat across the corpus (`front.jpg`
   28 times). Linking by basename made 2592 images collide, and since an existing
   destination reads as already-done they were dropped without a word. Links are
   now `<source>__<subject>[__<stem>]<ext>`.
2. **acne/skintype had no opt-in gate.** Their `ingest.collect_all()` reads every
   source folder unconditionally — unlike dimensions, which honour
   `DIMENSION_EXTRA_SOURCES` — so `acne/auto/` would have injected AI labels into
   the two heads that actually work (F1 0.741 / 0.691) with nobody opting in.
   `materialize()` now skips them unless `include_trained=True`. Labels are still
   recorded in the JSONL, just not used.

Also: `dimension/ingest.group_key()` folds `<source>__<subject>__<angle>` to the
subject, so one face's three frames can't straddle the train/val split.

**Annotator presence-bias, unresolved.** First 181 images: tone-consistency
118 present / 1 absent, redness 124/4, but dryness 100 absent / 6 present. Some
of that is real (these are condition datasets), some is likely the annotator's
threshold. §7.2's clinician spot-check (~20 per attribute) has NOT been done and
should gate any export to the PWA.

### 2026-08-01 — skintype's F1 0.691 was measured with train/val leakage

Found while wiring auto-labels into training. `build_master.split_rows` uses
`StratifiedGroupKFold` on `row["group"]`, and every ingest set `group = img.stem`.
killa92 ships each source photo across `train/`, `valid/` AND `test/` under
different Roboflow re-encode hashes, so **4145 skintype rows come from only 1672
distinct photographs — 2473 copies (60%) could sit on both sides of the split.**
Validation was scoring itself on images it had trained on. acne is barely
affected (22 copies).

`dedup.subject_group()` now extracts Roboflow's 20-hex source id (lookarounds
stop it matching inside their 32-hex re-encode hash) and is shared by the acne,
skintype and dimension ingests. **Expect the next skintype number to be LOWER
than 0.691 and to be the first honest one.** The old figure should not be quoted.

Also: phash near-duplicate detection is unreliable on this corpus. At Hamming
<=4 it merged 196 *different people* from `acnegrading/Level_0` — identical
black-background framing dominates an 8x8 DCT hash. Exact-phash dedup at manifest
build is fine (its 637 drops were verified genuine re-encodes by filename id);
do not lower the threshold to catch "near" duplicates.

### 2026-08-01 — skintype's real macro F1 is near chance, and the rubric was broken

**Two findings, both from wiring AI labels into training.**

**1. skintype was memorising duplicates.** With `subject_group` holding a photo's
Roboflow copies together (see above), a 12-epoch multi run gave
`skintype=0.259-0.318` across epochs 1-5 — against 4 classes, i.e. chance is
0.25. The shipped 0.691 came from validating on photos the model had trained on.
`acne` held at 0.60-0.70 (its reported 0.741 is roughly honest; only 22 of its
1695 rows were duplicated). **Do not quote skintype 0.691 anywhere.**

**2. Seven of ten presence criteria had no threshold.** After 425 records the
distribution was: pores 100% present, under-eye 100%, tone-consistency 100%,
texture 97%, oiliness 96%, pigmentation 95%, redness 94% — and, inverted,
dryness 2%. Splitting by source proved it was the rubric, not the corpus:
`pores`/`under-eye`/`tone-consistency`/`texture` came back 100% present even in
killa92, a skin-TYPE corpus full of normal skin. The criteria described anatomy
("individually visible pore openings", "darker than the cheek", "tone varies
between zones") which is true of every face at any resolution.

Rewritten with clinical thresholds + a **conversational-distance test** (is it a
feature of the face at ~1 m, or only when you zoom?), plus shadow-vs-pigment and
skin-tone guidance. v1 labels archived to `_labels/v1-pre-rubric-fix/` (not
deleted — they are the before-set if the thresholds ever need re-litigating) and
all 17 batches are being re-labelled.

Lesson for the next dimension added: check the present-rate BY SOURCE after ~200
records. A column that is 100% one class in a corpus known to contain both is a
rubric bug, and it is cheap to catch at 200 records and ruinous at 10,000.

### 2026-08-01 (later) — 109 scans annotated; the clinic corpus alone cannot train these

**All 109 staged scans are labelled** (4 batches, 766 labels applied, 7
quality-rejected, 260 uncertain excluded). The rewritten rubric holds: presence
rates are now spread (redness 41%, oiliness 49%, fine-lines 27%, wrinkles 20%)
instead of the 94-100% that made v1 untrainable. Nothing was flipped to balance
a column.

**The blocking finding.** Even if every consented pending scan were approved, no
dimension reaches the 40-per-class floor:

    redness  15/23    oiliness 19/19   fine-lines 30/20   wrinkles 38/10
    texture  44/4     pigmentation 30/6   pores 71/1   dryness 82/0
    under-eye 35/2    tone-consistency 62/3

Three of these are *structurally* starved, not just small: `dryness` (0 present
in 109 faces), `pores` (1), `under-eye` (2), `tone-consistency` (3). Clinic
patients photographed in good light largely do not exhibit them. **More clinic
scans will not fix these columns** — they need external corpora
(`make fetch-dimension-datasets`). Annotating more of the same is the expensive
way to learn this twice.

**Two safety fixes came out of the run.**

1. *Consent.* `annotation-manifest` did not filter on `consent_training`, so it
   staged 23 non-consented scans and they were labelled. Both the manifest and
   the applier now refuse them (109 candidates -> 85). Those scans never reached
   the trainer — `listTrainable` joins `training_queue` and a non-consented scan
   has no queue row, which is why the export kept reporting 8 labelled per
   dimension while `scan_labels` held 766 new rows. 174 inert labels remain on
   them; 34 older labels on the same scans are clinician work, so nothing was
   deleted.
2. *Split leakage, second route.* `subject_group` reads the subject from the
   FILENAME, but clinic scans are named with a bare UUID — so every scan was its
   own group and near-duplicate frames straddled the train/val split. Scans are
   now grouped by image content (`phash_group_map`), which groups rather than
   drops.

   **Be careful comparing the two hashes.** `training_queue.image_hash` is a
   dHash and shows 15 of 85 scans in 6 clusters at Hamming <= 10; the ingest
   groups by pHash, where that threshold means something different. The figures
   are not interchangeable. On the current 46-image redness export the grouping
   merges NOTHING — the closest surviving pair is 12 apart. It is verified to
   work (a duplicate frame a labeller flagged independently measures pHash 0),
   but it is presently a guard against future imports, not something actively
   holding this export together. Do not cite it as evidence the export is clean.

**Next session:** approve the 77 pending consented scans (clinician decision —
the annotation labels are not clinician grades), then fetch external corpora for
the starved dimensions. Do NOT annotate more clinic scans expecting the columns
to fill.

**Process note (still true):** append to this file, then verify the write landed.

**2026-08-01 approval.** 75 pending consented scans approved
(`reviewed_by = bulk-approval:annotation-2026-08-01`); 2 rejected left rejected,
0 non-consented in the queue. Export rebuilt: every dimension now carries 36-81
rows. All 10 remain `short`, and the shortfall is almost entirely on the
`present` side — `dryness` needs 40 positives and has 0, `pores` needs 38,
`under-eye` 38, `tone-consistency` 37. External corpora are the only route.

### 2026-08-01 (later) — rubric fix verified, and a manifest ordering bug

**The threshold rewrite worked.** 156 quality-ok records under the corrected
criteria, versus the degenerate columns it replaced:

    redness 52% present · pigmentation 43% · oiliness 47% · under-eye 20%
    texture 17% · fine-lines 11%        (all previously 94-100% present)

Six dimensions moved from unusable to trainable ranges. Three are skewed but not
blocked (pores 2%, wrinkles 2%, dryness 1%). One is still blocked:
**tone-consistency, 0 positives in 156** — either genuinely rare under the new
"frank dyschromia" wording or still too strict. Decide it on evidence at ~500
records, not before.

Projected images needed to reach 40/class: redness/oiliness ~207, pigmentation
~469, texture ~640, fine-lines ~1408, under-eye ~1760, wrinkles ~3520,
pores/dryness ~7040. **Finishing the corpus gets 9 of 10 over the bar** — the
run is worth completing, and the first four land inside ~26 batches.

**Manifest ordering bug (fixed).** `scan()` walks each source in path order and
sources keep one class per directory, so a source emitted its classes in blocks:
killa92's `oily` faces all sat past batch 62, `dry` past batch 8. Interleaving
SOURCES was not enough — a run could hit the 40/class bar having never shown the
model an oily face. `shuffle_within_source()` (seeded, so the manifest stays
reproducible) now mixes within each source before the round-robin. All four
killa92 classes now appear by batch 1, and batch 000 draws 4/4/4/4/3/3/3.

Rebuilding the manifest is SAFE for work already done: resume keys off the image
path, not the batch number — 176 records survived the rebuild untouched.

**Three rubric generations got mixed.** 24 records were graded against an
intermediate wording; two labellers independently flagged them rather than
silently rewriting. Archived to `_labels/v1-pre-rubric-fix/intermediate-rubric.jsonl`
and re-queued. Current-rubric records consolidated to `_labels/batch-pass1.jsonl`
so batch numbering could be reused after the rebuild.

Small fixes from labeller reports: queue files now end with a newline (one
labeller's line-reader dropped image 25), and the skill no longer points at
`docs/LABELLING-CONTEXT.md` as its source of truth — three annotators looked for
it beside the skill, did not find it, and correctly carried on.

### 2026-08-01 (later still) — one gate was suppressing three dimensions

At 220 records the omission/uncertainty profile showed the problem was no longer
thresholds but a **gate**: "Multi-angle — ambiguous on a single angle → omit",
applied to `under-eye`, `tone-consistency` and `pigmentation`. This corpus is
overwhelmingly single-angle, so the gate fired constantly:

    under-eye        79% omitted, 55% of the rest uncertain -> 21 usable of 220
    pigmentation     32% omitted, 73% uncertain             -> 40 usable
    tone-consistency 30% omitted, 0 positives

Clinically the gate was over-strict: periorbital hyperpigmentation is routinely
graded from single clinical photographs. The working discriminator is anatomical
extent, not light direction — **contour shadow is confined to a concavity and
fades where the surface turns convex; pigment crosses that boundary** onto the
lid or orbital rim and holds one hue. Multi-angle is now a bonus, not a
precondition.

**This loosening is monotone, so no re-labelling is needed.** A darkening
confined to the hollow was `absent` before and still is; what changes is that
previously-omitted images become assessable. Existing calls stay valid — which
is the only reason a third rubric revision was affordable.

**`oiliness` deliberately NOT changed.** Three labellers flagged it as running
hot and two tightened mid-batch (which is its own inconsistency — the rubric
should decide, not the annotator). But the numbers say 49% present / 45%
uncertain: a usable split, not a degenerate column. Their concern is validity
(clinical flash sheen vs sebum), which only the clinician spot-check can settle.
Re-cutting it blind would be thrashing. Left for the spot-check.

Effective yield is roughly HALF the earlier projection: uncertainty runs 45-73%
across most columns and uncertain labels are excluded from training. Re-do the
40/class projections against *confident* counts, not raw records.

### 2026-08-01 — source-balance guard (§7.1 finally in code, not just prose)

`redness` present-rate by source at 220 records: multi 92%, acne04 63%,
acne04full 58%, botox 55%, skindefects 41%, acnegrading 15%. A 6x spread.
`_multi` ships a curated Redness folder, so the enrichment is REAL — which is
why this needs a guard rather than a rubric fix. Left alone,
`redness/auto/present/` fills from one corpus and `absent/` from another: the
exact confound that scored four models 0.96-1.00 before they were deleted.

`ai/training/dimension/balance.py` scores total-variation distance between a
dimension's two source mixes; `materialize()` refuses to stage anything above
`MAX_TV_DISTANCE = 0.35` (`allow_skew=True` overrides). Counts only what would
actually train — quality-ok, minus `uncertain`.

Two things learned building it:

1. **A thin class makes TVD meaningless.** With 3 positives the mix is whichever
   corpus supplied them, and the first version blocked 9 of 10 dimensions on
   noise. A guard that always fires trains people to pass the override
   reflexively, which is how a guard stops working. `MIN_FOR_JUDGEMENT = 10`
   yields "no verdict yet" instead — explicitly NOT a pass.
2. **The check must read accumulated labels, not the batch being staged.** The
   folder it protects accumulates across batches; one 25-image file says nothing
   about the mix that will train.

Standing at 346 records: redness (69/53, TVD 0.38), pigmentation (26/22, 0.50),
oiliness (71/59, 0.53) and fine-lines (15/79, 0.67) are BLOCKED with enough data
to mean it. texture passes at 0.32. The rest have no verdict yet.

Open question this raises: `_multi`'s redness enrichment is structural, so that
column may never balance on its own. The fix is either capping positives per
source or holding clinic scans out for eval — decide when the counts are real.

### 2026-08-01 — oiliness: five labellers, one mechanism, one clarification

`oiliness` was flagged by five independent annotators. I left it alone twice on
the grounds that 49-55% present is a usable split — trainability was never the
problem. What finally forced the change was a different number: **138 of 303
assessments flagged `uncertain`** (46%), and two reports of annotators drifting
and self-correcting WITHIN a single unit ("records 1-13 have a looser oiliness
threshold than 14-25"). A rule that ambiguous costs half its data and produces
files holding two thresholds.

The annotators supplied the discriminator themselves: *"highlights sit only on
brow ridge, nose and lip convexities under one hard source; cheeks matte."*
So — the same anatomy-vs-light test that fixed `under-eye`, inverted:

    hard flash lights CONVEXITIES and skips the flats between them
    sebum covers the T-zone as a REGION, flats included, with a glossy/matte
    boundary at the cheeks

This **sharpens the existing rule rather than moving it** — "broad confluent
sheen over a zone" already excluded brow-ridge-only highlights; annotators were
applying it inconsistently. Existing `present` calls made on genuine T-zone sheen
stay valid, so no re-label. Misapplied ones are mostly already `uncertain` and
excluded from training anyway.

Also added: when the 20-in-a-row self-check fires, **re-grade the images already
done in that batch**. Tightening from image 14 leaves one file holding two
thresholds, which is worse than either applied consistently.

Standing at 378 quality-ok records: oiliness 55% present, redness 58%,
pigmentation 63%. **88 confidently acne-clear faces (23%)** — the §6 clear-skin
shortfall is being filled, slowly.

Corpus composition is the persistent confound and ordering cannot fix it: three
of the seven corpora are acne datasets, so any balanced sample is acne-heavy, and
`pigmentation` runs high because post-inflammatory macules are a genuine acne
sequela. The source-balance guard is what catches the downstream damage.

### 2026-08-01 — the brief contradicted itself on acne vs redness

A labeller found it, and it was real:

    §4.3   redness `present` = erythema in a vascular distribution
           "(malar, nasal, perinasal, OR OVER INFLAMMATORY LESIONS)"
    §4.3.4 disambiguation table: "Active inflammatory lesion -> `acne`,
           NOT `texture`, `redness`"

Two annotators reading different sections graded the same acne face oppositely,
which is most of why `redness` swung 46-83% between units. The table is the
clinically correct side: perilesional erythema is part of the lesion, and
counting it as `redness` turns that column into an acne proxy — the model would
learn to fire `redness` on every spotty face.

Fixed in BOTH the brief and the skill: `redness` is now explicitly independent of
acne lesions, and a face whose only red areas are its spots is `redness: absent`.

Reassuringly the labellers had mostly resolved it correctly on instinct — redness
was 52% present on acne-bearing faces vs 46% on clear ones, i.e. nearly
independent already. The contradiction was producing variance, not a systematic
error, so existing labels stand.

**Lesson: two sources of truth for one criterion will diverge.** The skill and
the brief now both state this rule; when either changes, change both, or delete
one of them.

### 2026-08-01 — I created the divergence I had just warned about

Having written "two sources of truth for one criterion will diverge", I then
fixed `under-eye` in the SKILL only and left `docs/LABELLING-CONTEXT.md` §4.3.3
saying `present` requires persistence "across viewing angles" with "single
ambiguous angle -> omit". A labeller caught it within one unit.

Both documents now carry the same three sharpened rules — anatomical extent for
`under-eye`, light geometry for `oiliness`, acne-independence for `redness`. The
skill also now instructs annotators to STOP and report a disagreement rather than
pick a side, which is how both contradictions surfaced.

**Standing rule: the skill and the brief are one rubric in two files. Change
both in the same commit, or the annotators will find out for you.**

The self-check is working as intended. Unit 005 hit the 20-in-a-row trigger on
`oiliness`, stopped, re-read two already-graded images against the sharpened
criterion, found the threshold had HELD (sheen covering mid-forehead and alar
creases as a region, not convexities), and correctly did not re-grade. That is
the behaviour the rule was written for — verify, then act on the finding, rather
than flip labels to hit a band.

### 2026-08-01 — clinician spot-check priorities, in order

Not yet done, and it gates any PWA export. Ranked by where the annotator's own
threshold is most likely wrong, which is a better ordering than by column size:

1. **`pores` — the viewing gate.** Standing at ~1-2% present. The gate says
   "assess fit-to-screen, never zoom", written so a 48MP phone and a 5MP phone
   produce the same label. But fit-to-screen on a 3000px whole-head portrait
   shows the face far larger than it appears at 1 m, so the two halves of the
   rule disagree, and annotators have been resolving it conservatively — calling
   `absent` and flagging uncertain. One labeller volunteered this as the column
   where its threshold is most likely wrong. If the clinician calls those faces
   `present`, `pores` is being systematically under-called and the gate needs a
   stated viewing size, not a stated distance.
2. **`oiliness`** — flash-lit clinical captures. The light-geometry rule holds up
   on inspection (sheen crossing mid-forehead and alar creases, not just
   convexities) but five annotators flagged it and the residual rate stays high.
3. **`pigmentation`** — brown-macule-vs-red-lesion separation on acne corpora.
   One labeller caught its own drift here and re-graded a whole unit; the rule
   works but is the hardest to apply.

Method per §7.2: clinician grades ~20 per attribute WITHOUT seeing the AI labels,
then compare. Poor agreement means fix the rubric, never raise the threshold.
