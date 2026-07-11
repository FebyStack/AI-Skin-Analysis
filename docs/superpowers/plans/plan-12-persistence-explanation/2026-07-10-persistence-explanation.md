# Face-Scan Persistence + Explanation Implementation Plan (Plan 12 / Phase C)

> **For agentic workers:** superpowers:subagent-driven-development or executing-plans. Spec: `docs/superpowers/specs/2026-07-10-face-analysis-architecture.md`. Depends on Plans 10–11.

**Goal:** Persist multi-image face scans (schema + routes), history, and the online/offline explanation story: Gemini enhances the client-computed report JSON (guardrailed), builtin content offline, auto-upgrade on reconnect.

**Architecture:** Client posts `{report, images[]}` → backend validates against `validateFaceReport` + re-checks invariants → saves scan + `scan_images` → attaches explanation (gemini|builtin) using the connectivity pattern from the lesion design (ConnectivityMonitor, health `llm`, idempotent enhance endpoint). Reuses `ai/llm` provider machinery.

**Tech Stack:** Express, pg, existing Gemini provider, vitest + supertest.

---

### Task 1: Schema — `scan_images` (+ report kind tolerance)

**Files:** Modify `database/schema/schema.sql` (append) · Test `backend/modules/analysis/face-repo.test.ts` (memory-level; pg impl mirrors existing patterns)

- [ ] **Step 1 — append to schema (idempotent):**

```sql
CREATE TABLE IF NOT EXISTS scan_images (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scan_id UUID NOT NULL REFERENCES scans(id) ON DELETE CASCADE,
  angle TEXT NOT NULL CHECK (angle IN ('front','left-45','right-45','left-profile','right-profile','forehead','chin')),
  image_jpeg BYTEA NOT NULL,
  image_width INT NOT NULL,
  image_height INT NOT NULL,
  quality JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS scan_images_scan ON scan_images (scan_id);
```
Note: schema self-applies on boot (existing behavior) — run `npm run dev:server` once from repo root and confirm boot logs clean; this IS the migration application step, say so in the commit message.

- [ ] **Step 2 — extend repositories:** `backend/modules/analysis/repository.ts` gains `FaceScanImage { id, scanId, angle, imageJpeg, imageWidth, imageHeight, quality }` + `ScanRepo.addImages(scanId, images[])`, `listImages(scanId)` (metadata only), `getImage(scanId, angle)`. Memory + Pg implementations follow the existing `scans` patterns exactly (Buffer for bytea, `isValidUuid` guards). Failing tests first (memory impl): add/list/get roundtrip, cascade-on-scan-delete (memory: delete scan removes images).
- [ ] **Step 3 — gates + commit** `feat(db): scan_images table + repo (multi-angle storage); schema self-applied`

---

### Task 2: Face explanation — builtin + Gemini enhancer

**Files:** Create `ai/llm/face-explainer.ts`, `ai/llm/fallback/face-education.ts` · Tests alongside

Mirrors the lesion explainer design 1:1 (same guardrail philosophy, JSON-only):

- [ ] **Step 1 — failing tests:** `face-education.test.ts`: builtin explanation exists for any report (uses top-3 highest-scoring dimensions to pick content), `source:"builtin"`, non-empty education, no certainty language. `face-explainer.test.ts`: prompt embeds report JSON + hard rules (no diagnosis/certainty/treatment beyond report's own recommendations, must keep disclaimer); guardrails reject certainty/prescription language; `explainFaceReport(report, callProvider)` validates + retries once + returns null on garbage.
- [ ] **Step 2 — implement:**

```typescript
// ai/llm/face-explainer.ts (shape — mirrors explainer.ts)
export const FACE_EXPLAIN_PROMPT_VERSION = 1;
export function buildFacePrompt(report: FaceReport): string {
  // embeds JSON.stringify(report.dimensions + overall + recommendations); rules:
  // - rephrase/personalize ONLY; never add clinical claims, treatments, or certainty
  // - respond with {"patientSummary", "education", "source":"gemini", "promptVersion":1}
}
export function checkFaceExplanationGuardrails(e: FaceExplanation): { ok: boolean; violations: string[] } {
  // certainty regex (same as lesion), treatment regex, non-empty fields
}
export async function explainFaceReport(report, callProvider): Promise<FaceExplanation | null> {
  // callProvider(prompt) → extractJson → validate shape → guardrails → retry once → null
}
```
```typescript
// ai/llm/fallback/face-education.ts
export function builtinFaceExplanation(report: FaceReport): FaceExplanation {
  // top-3 dimensions by score → per-dimension education paragraphs (authored, versioned),
  // patientSummary summarizes overall score band (calm/moderate/needs-attention wording,
  // suggestive language only), source: "builtin"
}
```
Full authored content per dimension (11 short paragraphs) — write them in the implementation, cosmetic-educational tone, no clinical claims.
- [ ] **Step 3 — gates + commit** `feat(ai): face report explainer (gemini json-only + builtin fallback)`

---

### Task 3: Face-scan routes

**Files:** Create `backend/modules/analysis/face-routes.ts` · Modify `backend/app/app.ts` (mount) + `backend/shared/deps.ts` (reuse `connectivity` + `explainProvider` fields from the lesion plan design; add them now if Plan 7 wasn't executed — same code as its Task 12) · Test `backend/app/face-flow.test.ts`

- [ ] **Step 1 — failing integration test (supertest):**
  - `POST /api/face-scans {patientId:"walk-in", report, images:[{angle,imageB64,mime}]}` → 200, scan persisted, `report.kind === "face-v2"`, images stored (5), explanation attached (`gemini` via fake provider when online / `builtin` when monitor offline)
  - invalid report (missing dimension) → 400 with validator errors
  - **server re-checks invariants**: report with `disclaimer: ""` → 400 (never trust client)
  - `GET /api/patients/walk-in/face-scans` → list without image bytes
  - `GET /api/face-scans/:id/images/front` → jpeg bytes, content-type
  - `POST /api/face-scans/:id/enhance` → upgrades builtin→gemini when online; 503 offline; idempotent when already gemini
- [ ] **Step 2 — implement:** handler order mirrors the lesion save-first rule: validate → compress each image (`compressToJpeg`, existing util) → save scan (report with `explanation: builtinFaceExplanation(report)`) + images → if `connectivity.isOnline()` try `explainFaceReport` → update row. Enhance endpoint identical in shape to the lesion `explain` endpoint.
- [ ] **Step 3 — gates (full suite; legacy counts unchanged) + commit** `feat(backend): face-scan persistence + enhance endpoint (save-first, offline-safe)`

---

### Task 4: History UI + wire-in

**Files:** Create `frontend/src/features/skin-analysis/components/history/FaceScanHistory.tsx` + `api/face-client.ts` · Modify `GuidedFaceScan` completion → POST via `face-client`, then render `FaceReportView` · Tests alongside

- [ ] **Step 1 — failing tests:** `face-client.test.ts` (saveFaceScan posts report+images, returns scan; auth error surfaces; requestFaceEnhance mirrors lesion pattern). `FaceScanHistory.test.tsx` (renders date + overall score per record from fixture list; empty state).
- [ ] **Step 2 — implement:** `saveFaceScan(report, capturedImages, patientId)` (frame JPEGs from Phase B canvas → base64), history list (responsive cards, tap → `FaceReportView`), reconnect upgrade wiring reuses `use-connectivity` + `requestFaceEnhance` (same container pattern as the lesion plan's `LesionResultContainer`).
- [ ] **Step 3 — LIVE verification:** dev servers up → complete a scan → appears in history → kill network (or force provider failure) → new scan shows builtin banner → restore → enhance swaps in place. Screenshots at 375/768/1280.
- [ ] **Step 4 — commit** `feat(ui): face-scan save + history + explanation upgrade`

---

## Self-review checklist
- [ ] History record has date/results/images/recommendations/explanation/confidence/timestamp (spec §HISTORY) ✓
- [ ] Server never trusts client report (validator + invariant re-checks) ✓
- [ ] Save-first ordering; Gemini failure can't lose a scan ✓ · images never sent to Gemini ✓
- [ ] Legacy tests unchanged; full suite green
