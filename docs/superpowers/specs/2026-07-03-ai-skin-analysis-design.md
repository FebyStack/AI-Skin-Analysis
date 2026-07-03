# AI Skin Analysis — Design Spec

**Date:** 2026-07-03
**Status:** Approved pending user review
**Target:** Prototype, later integrated into the existing Lovable website (GitHub: FebyStack/AI-Skin-Analysis)

## 1. Purpose

A public web tool that helps users decide whether to see a dermatologist. Users scan their skin with a live camera (face or any body area) or upload a photo; two independent AI analyses produce findings with honest confidence and "see a professional" guidance.

**It is a clinical aid, not a diagnostic device.** Every output uses "consistent with" language, never diagnoses, never prescribes treatment, and always includes the professional-care pathway.

### Analysis scope

Scope is defined by what standard-camera photographs can and cannot support, grounded in teledermatology and consumer-photo dataset evidence (SCIN, DermNet) — not by an arbitrary shortlist. The tool attempts to characterize the full range of visually-presenting skin conditions rather than a fixed menu, but draws a hard line at findings that photographs structurally cannot resolve.

**In scope — visually assessable from a standard photo.** The classifier and LLM cover the broad space of conditions that present visibly and dominate real user photos; the prompt/label taxonomy is open (SNOMED-CT / DermNet-class breadth) rather than a closed list. Representative families:

- **Inflammatory / allergic:** eczema (atopic dermatitis), contact dermatitis, psoriasis, rosacea, urticaria/hives, seborrheic dermatitis, general eruptions/rashes
- **Infectious:** tinea/ringworm and other fungal, bacterial (e.g. impetigo, cellulitis appearance), viral (herpes, warts), infestations (scabies)
- **Acne & follicular:** acne vulgaris, folliculitis
- **Pigmentary:** hyperpigmentation, melasma, post-inflammatory pigmentation, vitiligo
- **Hair & scalp:** pattern hair loss, alopecia areata (visible pattern only)
- **Nail:** onychomycosis and other visible nail changes
- **Cosmetic metrics:** oiliness, texture, pores, wrinkles, redness, hydration cues

**Out of scope — photographs structurally cannot resolve these (never verdicted):**

- **Malignancy determination.** The tool never outputs "benign", "cancer", or a malignancy probability. Distinguishing melanoma/BCC/SCC reliably needs **dermoscopy** (microscopic pigment-network/vascular patterns a standard photo cannot capture) and **palpation** (an actinic keratosis's sandpaper texture, a BCC's pearly raised border — flattened away in a photo). Lesions are handled by **red-flag escalation only**: visual ABCDE-style features (asymmetry, border, color variegation, diameter, apparent change) route the user to "features that warrant professional/dermoscopic evaluation — worth a look," never a risk score and never reassurance.
- **Anything requiring touch, depth, bleeding-on-manipulation, or history/systemic context** the photo can't convey.
- **Conditions on unsuitable images** — the quality gate (§3) refuses too-blurry, poorly-lit, or non-skin images rather than guessing; teledermatology evidence shows ~20% of user photos and ~⅓ of even dermoscopic images are unusable, so a hard quality floor is a scope boundary, not just UX.

This "broad detection, hard safety line" framing is what lets the classifier grow toward a standalone model (§6) without ever crossing into device-grade diagnostic claims.

### Constraints

- Small public launch: real strangers, operator-funded LLM calls → rate limiting, abuse protection, spend kill-switch
- Photos never persist anywhere (no server storage, no logging of image data)
- History is local-only (IndexedDB), opt-in, user-deletable
- Must integrate cleanly into an existing Lovable site (React + Vite + Tailwind + shadcn/ui + Supabase)
- UI/UX visual design is provisional and will be revised later; the component structure and flow are the stable part

## 2. Architecture (Approach 3 — client-heavy)

Everything heavy runs on the user's device. The only server piece is one Supabase Edge Function.

```
USER'S DEVICE (browser)                      SUPABASE EDGE FUNCTION
1. Capture (live camera or upload)           holds Claude key
2. Quality gate (MediaPipe):                 rate limits (hashed IP)
   face/region found, lighting, sharpness    daily spend kill-switch
3a. ONNX classifier (WebGPU, web worker) ──┐
3b. photo (opt-in, TLS) ────────────────►  │  Claude vision analysis (primary)
                                           │  Claude critique pass (cheap model)
    analysis + critique JSON ◄─────────────┘
4. Verdict merge (on-device, pure function)
5. Results + guidance → IndexedDB (local only)
```

**Why Approach 3:** prototype phase before public stability; near-zero server cost; strongest privacy claim (photos leave the device only for the opt-in LLM call, transiently). Trade-offs accepted: ~8–15MB lazy-loaded WASM/model download on entering the scan flow; low-end devices fall back to LLM-only mode. If the future learning loop demands Python, only the classifier extracts to a service later — the frontend contract doesn't change.

## 3. Feature module structure

All code lives in one portable folder; integration into Lovable = copy folder + copy Edge Function + add one route.

```
src/features/skin-analysis/
├── components/
│   ├── consent/        # ConsentGate, PrivacyExplainer
│   ├── capture/        # CameraFeed, FaceFrameGuide, CloseUpGuide,
│   │                   # QualityIndicator, UploadDropzone, ModeSwitch
│   ├── results/        # VerdictCard, FindingsList, ConfidenceBadge,
│   │                   # DisagreementFlag, GuidanceBanner, DisclaimerGate
│   └── history/        # HistoryTimeline, ScanCompare
├── hooks/
│   ├── use-camera.ts           # getUserMedia lifecycle, device switching
│   ├── use-quality-gate.ts     # MediaPipe checks
│   └── use-analysis.ts         # orchestrates the scan pipeline
├── ml/                 # pure functions + web worker, no React
│   ├── classifier.ts           # ONNX session load + inference
│   ├── quality.ts              # MediaPipe wrappers
│   └── verdict.ts              # merge logic (classifier × LLM × critique)
├── api/
│   └── analyze-client.ts       # Edge Function client; BYO-key override
├── store/
│   └── scan-machine.ts         # capture state machine (Zustand)
├── db/
│   └── history.ts              # IndexedDB via idb-keyval
├── privacy/
│   ├── consent.ts              # versioned consent state
│   └── redact.ts               # strips EXIF/GPS before anything sees uploads
└── types.ts                    # ScanResult, Finding, Verdict — the contract

supabase/functions/analyze/
├── index.ts                    # validate → rate-limit → pipeline
├── providers/anthropic.ts      # provider adapter (swappable)
├── critique.ts                 # second LLM pass
└── prompts.ts                  # dermatology system prompts, versioned
```

**Boundary rules:**

- Nothing outside the folder imports from inside it except the exported `<SkinAnalysisPage />` and route registration.
- `ml/` never touches React — testable without a browser, runs in a web worker so inference can't jank the camera UI.
- `types.ts` is the single contract: the Edge Function returns exactly these shapes; classifier and critique both produce `Finding[]` so the merge is symmetric.
- Capture flow is an explicit state machine: `idle → permission → framing → quality-check → ready → capturing → analyzing → results`, with `denied`, `no-face`, `low-light`, `blur`, `offline`, `analysis-failed` as first-class error states.

### Capture modes

1. **Face mode** — framing guide + face detection, for conditions/metrics
2. **Close-up mode** — free-form region guide for moles/lesions anywhere on the body
3. **Upload** — dropzone accepting photos of either kind; also the accessible alternative to live camera. EXIF/GPS stripped before preview.

## 4. Dual-AI pipeline

One scan fans out to two independent opinions plus a critique:

- **ONNX classifier (on-device, ~1s):** dermatology model (HAM10000/ISIC-class, ONNX-exported) → `Finding[]` with per-class confidence. Never sees the LLM's answer — true independence.
- **Claude vision analysis (primary, ~3–6s):** structured dermatology prompt → `Finding[]` + observations + reasoning.
- **Claude critique pass (cheap model, e.g. Haiku):** reviews the primary's reasoning against the image: conclusion follows from observations? overconfident? guardrail language intact? → `approved | amended | rejected`.

### Merge rules (`verdict.ts`, pure, exhaustively unit-tested)

| Classifier vs LLM | Result |
|---|---|
| Agree on a finding | Confidence raised; shown as "two independent analyses agree" |
| Only LLM finds it | Shown at LLM confidence, labeled single-source |
| Only classifier finds it | Shown as "flagged for attention" |
| Direct conflict | DisagreementFlag: both shown, wording escalates to "worth a professional look"; never resolved silently |
| Critique = rejected | Primary discarded, one automatic retry; second failure → honest error, never a degraded guess |

**Safety override:** a lesion red-flag from either source always escalates regardless of the other — safety findings don't average down.

### Degraded modes (honest, never silent)

- Edge Function unreachable → classifier-only result, labeled "partial analysis"
- Device can't run ONNX → LLM-only, labeled single-source
- Both fail → error with retry, never a fake result

### Provider adapter / swappable LLM

`providers/anthropic.ts` implements `analyze(image, prompt) → RawAnalysis`. Model IDs, API version, and key come from env config — switching Claude account/model is a config change; another provider is a new adapter file, zero pipeline changes.

**BYO key:** user-supplied Anthropic key stored only in their browser, sent per-request over TLS, never logged; overrides the operator key and bypasses the rate limiter. Default path uses the operator key with limits.

## 5. Privacy, consent, and guardrails

**Client:**

- `ConsentGate` blocks camera start and upload reading until explicitly accepted. Accepting covers sending scans to the AI service for the session ("opt-in" throughout this spec means this gate, not a per-scan prompt). Consent is versioned — policy text changes force a re-prompt.
- `PrivacyExplainer` in plain language: what runs on-device vs what is sent to the AI, nothing stored, how to delete history.
- EXIF/GPS stripped from uploads before preview, classifier, or network.
- History opt-in, with a visible "delete all history" wiping IndexedDB.

**Edge Function:**

- Accepts only image mime-types under a size cap; rejects everything else before the LLM sees it.
- Output schema validation: LLM must return strict `ScanResult` JSON; malformed or out-of-vocabulary output is rejected, never shown.
- Prompt guardrails enforced by the critique pass: no diagnosis ("consistent with" only), no treatment/medication advice, professional-care pathway always present, urgent-looking findings escalate rather than reassure.
- No image logging; rate-limit counters keyed on hashed IP only.

## 6. Learning loop (future; designed-for, only Tier 1 ships)

The browser cannot retrain ONNX on-device, and photos are never kept — so disagreements alone are not trainable data. Three tiers:

1. **Calibration (ships with prototype):** opt-in anonymized disagreement records (both AIs' findings + outcome, never the photo) accumulate in a Supabase table. Systematic classifier errors on a class are corrected by adjusting that class's confidence threshold and merge weight — learning without touching the model.
2. **Image donation (future):** a separate explicit checkbox at the moment of disagreement — "donate this photo to improve the model." **Strictly consent-gated: no donation consent → the photo and its scan data are never used for training, full stop.** Donation consent is independent of the session ConsentGate, versioned the same way, and revocable (revocation stops all future use). Donated images are labeled with Claude's verdict (knowledge distillation; disagreements are the highest-value samples — active learning).
3. **Offline fine-tune (future):** periodic Python pipeline fine-tunes on donated images only, re-exports ONNX, ships a versioned model file. New versions run in shadow mode (scored against Claude on live scans without affecting verdicts) and are promoted only if agreement improves.

**End goal:** through these tiers the classifier graduates into a standalone skin-analysis model of its own — eventually able to carry the primary analysis itself, with the LLM demoted to critique/fallback. The architecture already supports this: the merge in `verdict.ts` is symmetric, so promoting the classifier to primary is a weight change, not a redesign.

Consent versioning and model-file versioning are built in the prototype so Tiers 2–3 need no re-architecture.

## 7. Design system & UX

Provisional — visual design will be revised later; structure below is the stable part.

- **Direction:** clinical-clean credibility (white surfaces, teal `#0f766e` for data/actions) with warm-wellness accents (cream/stone neutrals, rounded corners, reassuring precise language). Amber reserved for disagreement/attention flags.
- Tokens as CSS variables consumed by Tailwind; matches Lovable's shadcn/ui theming so the module inherits the main site's theme with a small override file.
- Results screen pattern: verdict summary card → per-finding cards with source badges ("✓ 2 analyses agree" / "⚑ analyses differ") and confidence bars → non-diagnosis disclaimer → save-to-history / new-scan actions.

## 8. Accessibility

- Every visual capture guide (framing, lighting warnings) has a live-region text equivalent.
- Capture operable by keyboard and button; never gesture-only.
- Results readable by screen reader in severity order.
- WCAG 2.1 AA contrast (warm palette verified against this).
- Upload path is the fully accessible alternative to live camera.

## 9. Testing

- `verdict.ts` merge rules and consent versioning: exhaustive unit tests (pure functions, highest-stakes logic).
- Edge Function: contract tests with mocked Claude responses — schema validation, guardrail rejection, rate limiting.
- Capture state machine: headless transition tests, no real camera.
- One Playwright smoke test with a fake camera stream through the full flow.
- CI: typecheck, lint, tests on every push.

## 10. Deployment & integration

- **Prototype:** static app on Vercel/Netlify free tier; Edge Function in the existing Supabase project.
- **Integration into Lovable site:** copy `src/features/skin-analysis/` and `supabase/functions/analyze/` into the Lovable repo via its GitHub sync; add one route rendering `<SkinAnalysisPage />`. ML assets (~8–15MB) lazy-load only inside the scan flow — the main site's performance is untouched.

## 11. Out of scope (prototype)

- Server-side accounts or server-stored history
- Tier 2–3 learning loop (image donation, fine-tuning, shadow evaluation)
- Payments/quotas beyond rate limiting + kill-switch
- Native apps
- Final visual design polish (explicitly deferred)
