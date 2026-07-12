# PWA + Sync + Model Distribution Implementation Plan (Plan 13 / Phase D)

> **For agentic workers:** superpowers:subagent-driven-development or executing-plans. Spec: `docs/superpowers/specs/2026-07-10-face-analysis-architecture.md`. Depends on Plans 10–12.

**Goal:** Installable offline-first PWA: app-shell caching, IndexedDB offline scan queue + sync, versioned model distribution (manifest + sha256 + atomic switch) with admin promote/rollback.

**Architecture:** Hand-rolled service worker (no workbox dep): precache shell, cache-first for `/models/*`, network-only for `/api/*`. Offline queue in IndexedDB flushed by a sync module. Backend `models` module serves a registry-backed manifest + immutable artifact files; admin endpoints promote/rollback (session-auth = admin, per existing single-operator model).

**Tech Stack:** Service Worker API, IndexedDB (idb-free, thin wrapper), Express, vitest.

---

### Task 1: Model registry + distribution endpoints

**Files:** Create `backend/modules/models/repository.ts`, `backend/modules/models/routes.ts` · schema append · Test `backend/app/models-flow.test.ts`

- [ ] **Step 1 — schema append (idempotent):**

```sql
CREATE TABLE IF NOT EXISTS model_registry (
  name TEXT NOT NULL,
  version TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('production','candidate','archived')),
  manifest JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (name, version)
);
```

- [ ] **Step 2 — failing integration test:** seed registry (memory repo) with `face-landmarker@1.0.0 production` whose manifest lists `face_landmarker.task {sha256, bytes}` →
  - `GET /api/models/manifest` (auth) → `{models: ModelDescriptor[]}` production-only, full D8 metadata (name, version, task, framework, files{path,sha256,bytes}, inputSpec?, classes?, metrics?, datasetManifestSha256?, createdAt, notes?)
  - `GET /api/models/files/face-landmarker/1.0.0/face_landmarker.task` → bytes + `cache-control: public, max-age=31536000, immutable`
  - `POST /api/models/face-landmarker/promote {version}` (auth) → candidate→production, old production→archived
  - `POST /api/models/face-landmarker/rollback {version}` (auth) → archived version→production, current→archived
  - promote/rollback to nonexistent version → 404; registry never deletes rows
- [ ] **Step 3 — implement:** `ModelRegistryRepo` (interface + Memory + Pg, existing patterns); files served from `ai/models/<name>/<version>/<file>` on disk (path-traversal guard: resolve + prefix check). Routes mounted in `app.ts`.
- [ ] **Step 4 — gates + commit** `feat(backend): model registry + manifest/artifact distribution + promote/rollback`

---

### Task 2: ModelUpdateService (implements the Phase A reserved interface)

**Files:** Create `frontend/src/features/skin-analysis/pwa/model-update-service.ts` · Test alongside

v3.1: implements `ModelUpdateService` from `ai/face/models/manager.ts` (`sync()`, `rollbackLocal(name)`), drives `ModelManager.activate` after verification, and keeps the PREVIOUS version's cached files until the new version fully verifies — that cached previous version is what `rollbackLocal` reactivates. Manifest entries are full `ModelDescriptor`s (D8 metadata).

- [ ] **Step 1 — failing test:** with injected `fetchFn` + in-memory `CacheLike { put,get,delete,keys }`:
  - fresh install: downloads all manifest files, verifies sha256 (WebCrypto `crypto.subtle.digest`), stores under key `name@version/file`, records `activeVersion`
  - corrupted file (hash mismatch) → keeps previous active version, reports error
  - unchanged manifest → no downloads
  - version bump → downloads, switches `activeVersion` only after ALL files verify, purges old version keys
- [ ] **Step 2 — implement:** ~80-line module: `syncModels(manifest, cache, fetchFn) → {name→activeVersion}`; `modelUrl(name, file)` resolves to the cached response (used by the mediapipe wrapper via a cache-first SW route — Task 3 routes `/models/*` through Cache Storage so `LANDMARKER_MODEL_URL` keeps working untouched).
- [ ] **Step 3 — gates + commit** `feat(pwa): verified model updater with atomic version switch`

---

### Task 3: PWA shell — manifest + service worker

**Files:** Create `frontend/public/manifest.webmanifest`, `frontend/public/sw.js`, `frontend/src/pwa/register-sw.ts` · Modify `frontend/index.html` (link manifest, register SW) · Test `frontend/src/pwa/register-sw.test.ts` (registration guard logic only)

- [ ] **Step 1 — manifest:** name "AI Skin Analysis", display standalone, theme `#0f766e`, icons 192/512 (generate two solid-color PNGs with the clinical palette via a tiny node script into `frontend/public/icons/` — committed).
- [ ] **Step 2 — service worker (`sw.js`, plain JS, versioned `CACHE_V`):**
  - install: precache `/`, built asset list injected at build (`vite` plugin not needed: precache `/` + navigate-fallback; hashed assets are cached at first use, runtime cache-first)
  - fetch strategy: `/api/*` → network-only (offline queue handles failures at app level); `/models/*` → cache-first (Cache Storage, populated by Task 2); navigations → network-first falling back to cached `/`; hashed `/assets/*` → cache-first
  - activate: purge caches not matching `CACHE_V`
- [ ] **Step 3 — register-sw.ts:** register only in production build + `"serviceWorker" in navigator` (unit-test the guard with injected navigator).
- [ ] **Step 4 — verify:** `npm run build && npm run preview` → Application tab: installable, SW active; kill network → app shell still loads. Commit `feat(pwa): manifest + service worker (offline shell, cache-first models)`

---

### Task 4: Offline scan queue + sync

**Files:** Create `frontend/src/features/skin-analysis/pwa/scan-queue.ts`, `frontend/src/features/skin-analysis/hooks/use-sync.ts` · Tests alongside

- [ ] **Step 1 — failing tests:** `scan-queue.test.ts` with fake IndexedDB (in-memory Map impl of the 4 used methods):
  - `enqueue(report, images)` persists; `pending()` lists; `flush(postFn)` posts FIFO, removes on success, stops on first failure (retries later), never loses an entry on thrown postFn
  `use-sync.test.ts`: backend-reachable flip triggers flush (reuses `use-connectivity`'s reconnect callback pattern against `/api/health` reachability — NOT the llm field).
- [ ] **Step 2 — implement:** thin IndexedDB wrapper (open db `skin-scans`, store `queue`, autoIncrement), `saveFaceScan` in face-client falls back to `enqueue` on network error and surfaces "pending sync" state; history view shows queued items with a badge.
- [ ] **Step 3 — LIVE verify:** dev servers → stop backend → complete scan → "pending sync" badge → start backend → auto-flush → record appears server-side. Screenshots.
- [ ] **Step 4 — commit** `feat(pwa): offline scan queue + auto-sync on reconnect`

---

### Task 5: Wire model channel + finish

**Files:** Modify `ai/face/landmarks/mediapipe.ts` (WASM self-host: copy `@mediapipe/tasks-vision/wasm/*` to `frontend/public/mediapipe-wasm/` via a postinstall script; `WASM_BASE = "/mediapipe-wasm"`) · seed registry with `face-landmarker@1.0.0` (script `ai/models/seed-registry.ts` or SQL insert doc) · docs update

- [ ] **Step 1:** self-host wasm (removes the CDN dependency — offline-first requires it); verify landmarker loads offline in preview.
- [ ] **Step 2:** app boot calls `syncModels` from the manifest endpoint (silent failure = keep cached versions).
- [ ] **Step 3:** full gates: typechecks, full vitest suite, `make -C ai test` (if Plan 7 python exists on this branch — else skip), `make build` (docker), PWA installability check.
- [ ] **Step 4 — commit** `feat(pwa): self-hosted wasm + model channel boot sync`

---

## Self-review checklist
- [ ] Offline-first as property: shell offline ✓ analysis offline ✓ queue+sync ✓ models cached+verified ✓
- [ ] Two connectivity axes separated (backend reachability vs llm) ✓
- [ ] Model lifecycle: manifest, immutable artifacts, promote, rollback, registry never deletes ✓
- [ ] No CDN at runtime ✓ · path-traversal guard on artifact serving ✓
