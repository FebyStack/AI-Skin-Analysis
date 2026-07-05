# AI Skin Analysis — Design Spec (v2 — Clinic Edition)

**Date:** 2026-07-03 · **Revised:** 2026-07-04 (architecture pivot: local clinic deployment)
**Status:** v2 approved direction — supersedes the public-web architecture of v1 (see git history)
**Target:** A local clinic tool. Runs on one clinic laptop via Docker, portable to another laptop by moving the Docker volume / a database dump. Not deployed publicly.

## 1. Purpose

A clinic-local web tool that helps practitioners assess skin and decide whether/what to refer to a dermatologist. Staff scan a patient's skin with the laptop/phone camera (face or any body area) or upload a photo; two independent AI analyses produce a detailed, structured report; results and compressed photos are stored per patient in a local database with full history and before/after comparison.

**It is a clinical aid, not a diagnostic device.** Every output uses "consistent with" language, never diagnoses, never prescribes treatment, and always includes the professional-care pathway.

### Analysis scope

Unchanged from v1: broad, open taxonomy of visually-presenting conditions (inflammatory/allergic, infectious, acne/follicular, pigmentary, hair/scalp, nail) with the hard photographic line — no malignancy verdicts (red-flag escalation only), no claims requiring dermoscopy/palpation/systemic context, quality-gated images only.

### Primary focus: facial skin analysis

**Face-mode analysis is the product's core.** The capture flow defaults to face mode, the report dimensions/facial map/skin-type features are designed around the face, and UI priority follows. Body close-up mode exists for lesion/mole checks but is secondary (single-region observations, no facial map, dimensions where applicable).

### Reference device (feature benchmark)

Benchmark: the GZ Beauty 14.2" Intelligent Skin Analyzer (MLB-E02) — https://gzbeautydevice.com/skin-analyzer/ — a professional clinic device whose feature set defines our target vocabulary:

- **Nine analysis items across three light spectra:** green light/surface (hydration, oil, pigmentation, pores, wrinkles); red light/deep layer (pigmentation, spots, blood circulation, collagen, sensitivity); blue light/pore level (enlarged pores, blackheads, acne, inflammation).
- **AI image recognition with automatic report generation**, problem-area highlighting on the face image ("professional skin condition mapping"), 3D-style reports.
- **Client records, before/after comparison**, membership-style history.
- Hardware: 15 MP handheld lens, 200x magnification, real multi-spectral illumination.

**What we match:** the full analysis-item vocabulary (as the 12 report dimensions below), facial problem-area mapping (our zone-tagged facial map), automatic AI report generation, patient records, history, and before/after comparison.

**What we deliberately do NOT match:**
- *Spectral/hardware measurement claims* — a standard camera cannot do green/red/blue spectral imaging or 200x magnification. Our equivalents are AI visual inferences and are labeled so ("visual proxy") — permanently.
- *AI-matched product recommendations* — the device upsells products; our guardrails **forbid** product/treatment recommendations. This is a safety feature, not a gap.

### Deep-analysis reference (ISEMECO 2D S7) and our camera analog

Second benchmark: the ISEMECO 2D S7 (https://www.meicet.com/) — a multi-spectral clinic analyzer offering **9 imaging modes**: RGB, balanced-polarized (epidermis), cross-polarized (dermis), near-infrared (subsurface), brown/pigment zone, UVA, UV-pigment, red zone (vascular/inflammation), mixed-UV — plus symptom annotation/measurement and mirror/dual/quad/3D comparison.

This device defines "deep analysis." Because we are a **camera version** (no polarizing filters, UV/IR emitters, or optics), we implement the analyses a single visible-light frame can *honestly* support and refuse the rest:

**Derived imaging views — computed from the captured RGB frame (real pixel processing, not AI guesses, not hardware spectra):**
- **Pigmentation map** — melanin/brown-cue emphasis via color-channel separation. Analog of the device's brown/pigment zone.
- **Redness (vascular) map** — erythema emphasis via red/`a*`-channel isolation. Analog of the red zone.
- **Texture/relief map** — high-pass surface detail. Analog of polarized surface texture.

Each derived view is labeled **"derived from the visible-light photo — not spectral/UV/IR imaging."** They are deterministic image transforms of the same photo (offline, on-device), shown alongside the original as a multi-view panel (our honest analog of the 9-image display) and feed the AI's per-dimension reasoning.

**Symptom annotation & measurement** — the practitioner can mark and measure a region on the still (pixel-space; distances are relative unless a calibration reference is later added).

**Refused — needs hardware, never simulated:** UV/UVA fluorescence, balanced/cross-polarized, near-IR/subsurface, true melanin-depth, and 3D reconstruction from a single 2D frame. The report never presents a fabricated UV/IR/3D image.

### Report dimensions (every face scan)

Modeled on the reference device's nine items but **honestly framed** via AI visual inference:

- **Hydration appearance** — flakiness, dullness, dehydration lines. *Visual proxy — never claims measured moisture.*
- **Oiliness** — shine/sebum appearance by zone
- **Pigmentation** — hyperpigmentation, PIH, **melasma-pattern**
- **Spots** — discrete lentigines/dark-spot count & prominence
- **Pores** — visibility/congestion by zone
- **Blackheads/comedones** — pore-level congestion appearance
- **Wrinkles & texture** — fine lines, roughness, smoothness
- **Acne** — presence, type appearance, affected zones
- **Inflammation** — active irritation appearance
- **Redness / circulation cues** — erythema, rosacea-pattern flushing. *Visual proxy for "blood circulation."*
- **Sensitivity cues** — visible reactivity indicators
- **Elasticity/collagen appearance** — sag/plumpness visual cues. *Visual proxy — no device measurement.*
- **Skin type** — sebum pattern (normal/oily/dry/combination), sensitivity flag, approximate Fitzpatrick I–VI (labeled approximate; also calibrates interpretation across skin tones)
- **Surface vs depth framing** — all detection is surface-level; "surface features suggestive of…" only.
- **Trend outlook** — per-dimension improving/stable/worsening across the patient's scan history; never a prognosis.

### Facial map & observations

Unchanged: zone-tagged findings (forehead, nose, cheeks, chin, periorbital) rendered on a face diagram with per-zone observations; close-ups get single-region observations.

### Reports

- On-screen structured report per scan (summary → facial map → dimension scores → findings with dual-AI badges → trends → disclaimer).
- **Downloadable PDF** generated on-device, same content + disclaimer.
- **Before/after comparison**: any two scans of the same patient side-by-side with per-dimension deltas.

## 2. Architecture (v2 — local Docker stack)

Everything runs on the clinic laptop. Internet is needed **only** for the Claude analysis call; browsing patients, history, reports, and images is fully offline.

```
CLINIC LAPTOP (Docker Compose)
├── web  — nginx serving the built React app (same feature module as v1/v2 frontend)
├── api  — Node service:
│     • auth (single shared clinic password → session cookie)
│     • analysis pipeline (reuses the Plan-3 pure modules: prompts,
│       guardrails, provider adapter, critique, contract validation)
│     • image post-processing: re-encode to JPEG, downscale + compress
│     • Postgres access (patients, scans, reports)
│     • holds ANTHROPIC_API_KEY (env/.env file, never in the image)
└── db   — Postgres 16, named volume `skin_data`

Browser (on the laptop, or phones on the clinic LAN) → web → api → db
                                            api → Anthropic API (internet, analysis only)
```

**On-device ML stays in the browser** (unchanged from Plan 2): MediaPipe quality gate + ONNX classifier run client-side before anything is sent — the independent second opinion and the quality floor.

**Camera sources & QR remote capture:** capture works with the laptop's built-in webcam, an external USB camera (device picker via `enumerateDevices`), or **any phone/external device via QR pairing**: the desktop scan flow shows a QR code encoding `http://<lan-ip>:<port>/capture/<token>`; the phone scans it, opens a capture-only page (no login — the short-lived token *is* the authorization), runs the same camera + quality-gate flow, and uploads the photo to the api. The waiting desktop session receives the image (polling the capture-session endpoint) and continues into analysis as if captured locally. Tokens are single-use, expire in ~5 minutes, and grant upload-only access to that one capture session.

**Portability:** move to another laptop via `docker compose down` → copy the `skin_data` volume (or `pg_dump` file) → `docker compose up` on the new machine. A `make backup` / `make restore` script pair wraps this.

**Offline behavior (hybrid):** no internet → new scans run classifier-only and are stored labeled **"partial analysis — AI review pending"**; a stored partial scan can be re-analyzed when back online. History/patients/reports always work offline.

**What v1 public-web machinery is dropped:** Supabase Edge Function, Vercel hosting, per-IP rate limiting, global spend kill-switch, BYO keys. (A simple daily-scan counter remains as a cost sanity check, configurable.)

## 3. Data model (Postgres)

```sql
patients:  id (uuid pk), name, external_ref (clinic's own patient no., nullable),
           notes, created_at, updated_at
scans:     id (uuid pk), patient_id (fk), mode (face|closeup), created_at,
           image_jpeg (bytea, compressed), image_width, image_height,
           report (jsonb, the AnalysisReport contract), partial (bool),
           classifier_findings (jsonb), prompt_version (int)
settings:  key (pk), value — includes password_hash (bcrypt), consent_text_version,
           daily counter state
```

- **Images:** after analysis completes, the captured image is re-encoded to **JPEG**, downscaled to max 1280px on the long edge, quality ~0.8 → typically 100–300 KB, stored as `bytea` with the scan. One volume/dump therefore carries *everything* (photos included) between laptops.
- **Deletion:** deleting a patient cascades to their scans/images; single scans deletable too.
- The `report` JSONB is exactly the wire `AnalysisReport` contract, so history rendering reuses the same validators/components.

## 4. Dual-AI pipeline

Unchanged from v1 in substance: on-device ONNX classifier (independent, never sees the LLM's answer) + Claude vision analysis + Claude critique pass (approved/amended/rejected, one retry, honest failure); merge rules with agreement badges, disagreement flags, and the safety override (lesion red-flags always escalate). Provider adapter keeps the LLM swappable via env config. Degraded modes: offline → classifier-only "partial"; classifier unavailable → LLM-only single-source.

## 5. Privacy, consent, and guardrails (clinic reframe)

The clinic is now the data custodian — photos and results ARE stored, locally.

- **Patient consent is a workflow step**: before a patient's first scan, the app shows a consent screen the practitioner reviews with the patient (what is analyzed, what is stored locally, that the photo is sent to the AI service transiently for analysis, that this is not a diagnosis). Consent recorded per patient (versioned; text changes re-prompt).
- **Storage is local-only**: nothing is stored outside the clinic laptop's database. The Anthropic call remains transient (image analyzed, not retained by the app's server; no image logging in the api container).
- **Access control**: single shared clinic password (bcrypt hash in `settings`), session cookie; the app is unusable without login. LAN exposure is opt-in (bind to localhost by default; a compose override exposes to the LAN for phone capture). **QR capture tokens** are the one passwordless path: single-use, ~5-minute expiry, scoped to uploading one image into one capture session — they can't read any patient data.
- **Deletion**: per-patient and per-scan delete, immediate and real (no soft-delete retention).
- **EXIF/GPS stripping** stays (uploads may come from patient phones).
- **LLM guardrails** unchanged: schema-validated output, forbidden diagnosis/prescription language, disclaimer enforcement, escalation wording on red flags.

## 6. Learning loop (future; unchanged shape, easier locally)

Tier 1 calibration data (dual-AI agreement outcomes) now accumulates naturally in the local `scans` rows — no telemetry service needed. Tiers 2–3 (training-image use, offline fine-tune, classifier graduating toward a standalone model with the LLM as critic) remain future work and remain **strictly consent-gated per patient**: no consent, no training use, revocable.

## 7. UX

- **Design system**: unchanged (clinical-clean + warm accents; provisional visuals).
- **App shell**: Login → Patients list (search/add) → Patient page (profile, scan history timeline with thumbnails, "New scan", "Compare") → Scan flow (consent check → capture → quality gate → loading screen → report) → Report page (dimensions, facial map, findings, PDF download). The capture step offers **three sources**: this device's camera (with device picker for external/USB cameras), photo upload, or **"Use another device"** (QR code; the paired phone captures and the desktop flow continues automatically).
- **Analysis loading screen** and **quality guidance dialog**: unchanged from v1 spec (staged real-pipeline progress; per-issue fix instructions in an `alertdialog`; upload fallback after repeated failures).
- **History with pictures**: patient timeline shows compressed JPEG thumbnails; tapping opens the stored report exactly as originally rendered; before/after picks any two scans.
- **Responsive**: unchanged (phone + desktop; phones on the clinic LAN can run the capture flow).

## 8. Accessibility

Unchanged from v1 (live-region equivalents for capture guides, keyboard operability, AA contrast, screen-reader-ordered results).

## 9. Testing

- All existing unit tests carry over (60 passing at pivot time).
- API container: contract tests with mocked Claude (schema/guardrails/critique), auth tests, image-compression tests (dimension + size bounds), patient/scan CRUD tests against a throwaway Postgres (docker compose test profile or testcontainers).
- Frontend: history/compare components tested against golden report fixtures.
- One end-to-end smoke: compose up → login → create patient → upload scan (mock LLM) → report stored → visible in history with thumbnail.

## 10. Deployment & operations

- `docker compose up -d` on the clinic laptop; app at `http://localhost:8080` (compose override for LAN).
- `.env` holds `ANTHROPIC_API_KEY`, models, port, daily-cap; never committed.
- `make backup` → timestamped `pg_dump` (photos included); `make restore <file>` on the new laptop. Volume copy also documented.
- Frontend and api built into images by a multi-stage Dockerfile; `docker compose build` is the whole release process.

## 11. Out of scope

- Public deployment, rate limiting/abuse machinery, BYO keys (dropped with v1 architecture)
- Multi-clinic sync, cloud backup
- Per-staff accounts and audit logs (single shared password chosen)
- Tier 2–3 learning loop
- Real spectral imaging claims — never; visual-proxy labeling is permanent
- Final visual polish (deferred as before)

## Plan impact (v1 → v2)

- **Plans 1–2 (merged):** unchanged and fully reusable — capture, consent components (text will be reworded for clinic context), quality gate, classifier.
- **Plan 3 (drafted, not executed):** superseded in *transport*, preserved in *substance* — contract, prompts, guardrails, provider adapter, critique, and pipeline modules move from a Supabase Edge Function to the local Node api container almost unchanged; rate-limit/BYO tasks are dropped, image compression + storage added.
- **New Plan 4:** Docker stack — compose, Postgres schema/migrations, api service (auth, CRUD, pipeline, compression), backup/restore.
- **Plan 5:** Results & report UI (facial map, dimensions, PDF) — mostly as previously envisioned.
- **Plan 6:** Patients & history UI (profiles, timeline with thumbnails, before/after compare, consent workflow).
