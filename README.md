# AI Skin Analysis

A privacy-first web tool that helps people decide **whether to see a dermatologist**. Users scan their skin with their device camera (phone or PC) or upload a photo; two independent AI analyses produce findings with honest confidence and clear "see a professional" guidance.

> **Not a diagnostic device.** This tool is a clinical aid. It never diagnoses, never prescribes treatment, and never determines whether something is cancerous. Every result points to professional care where appropriate.

## Status

Prototype. Built as a **portable feature module** that later drops into the main [Lovable](https://lovable.dev) website (repo: [FebyStack/AI-Skin-Analysis](https://github.com/FebyStack/AI-Skin-Analysis)) with a folder copy + one route.

## What it does

- **Guided capture** — live camera (face mode or free-form body close-up) or photo upload, on phone or desktop, using the device's own camera.
- **Quality gate** — on-device checks (region present, lighting, sharpness) refuse unusable images instead of guessing.
- **Dual-AI analysis** — an on-device ONNX classifier gives an independent second opinion, while a swappable LLM (Claude) performs the primary analysis plus a critique pass. The two are merged: agreement raises confidence; disagreement is flagged, never hidden.
- **Honest guidance** — findings use "consistent with" language; lesion red-flags escalate to "worth a professional look"; results always include the non-diagnosis disclaimer.
- **Local-only history** — optional, stored in the browser (IndexedDB), deletable anytime. No accounts, no server-stored photos.

## Analysis scope

Grounded in what standard-camera photos can and cannot support (teledermatology + consumer-photo dataset evidence — SCIN, DermNet).

- **In scope:** broad, open taxonomy of visually-presenting conditions — inflammatory/allergic (eczema, contact dermatitis, psoriasis, rosacea, hives), infectious (fungal/tinea, bacterial, viral, scabies), acne/follicular, pigmentary (melasma, PIH, vitiligo), hair/scalp, nail, and cosmetic metrics (texture, pores, wrinkles, redness, oiliness).
- **Out of scope (never verdicted):** malignancy determination (needs dermoscopy + palpation a photo can't provide), anything requiring touch/depth/systemic history, and unusable images. Lesions get **red-flag escalation only** — never a "benign" or "cancer" call.

See the full spec: [`docs/superpowers/specs/2026-07-03-ai-skin-analysis-design.md`](docs/superpowers/specs/2026-07-03-ai-skin-analysis-design.md).

## Architecture (at a glance)

Client-heavy. Everything except the LLM call runs on the user's device.

```
USER'S DEVICE (browser)                 SUPABASE EDGE FUNCTION
capture → quality gate → ONNX classifier     holds Claude key
                              │              rate limit + spend kill-switch
   photo (opt-in, TLS) ───────┼──────────►   Claude analysis + critique
   verdict merge ◄────────────┘
   results → IndexedDB (local only)
```

- **Frontend:** React + Vite + TypeScript + Tailwind + shadcn/ui (matches Lovable).
- **On-device ML:** MediaPipe (quality gate) + ONNX Runtime Web / WebGPU (classifier), in a web worker.
- **Server:** one Supabase Edge Function — the only backend; holds the Claude key, rate-limits, enforces guardrails. Photos are never stored or logged.
- **Swappable LLM:** provider adapter; switch Claude model/account via config. Users may optionally supply their own key (stored in their browser).

## Cross-platform & camera

Runs in any modern browser on **iOS, Android, and desktop** — no native app. Uses `getUserMedia` for the live camera (rear camera default for body close-ups, front for face mode, device picker on desktop) and falls back to the upload path when no camera or permission is available. HTTPS-only (required for camera access). Mobile-first responsive layout verified at phone / tablet / desktop widths.

## Privacy & safety

- Explicit, versioned **consent gate** before any camera or upload access.
- **EXIF/GPS stripped** from uploads before anything reads them.
- Photos **never persist** on any server; history is local-only and user-deletable.
- Edge Function validates output schema and enforces prompt guardrails (no diagnosis, no prescriptions, always a professional-care pathway).
- Future model-training data use is **separately consent-gated** — no consent, no use.

## Project layout

```
docs/superpowers/specs/   design spec (source of truth)
src/features/skin-analysis/   the portable feature module (to be built)
supabase/functions/analyze/   the LLM proxy Edge Function (to be built)
```

## Roadmap

- **Now (prototype):** on-device classifier + Claude analysis, local history, rate limiting, consent/guardrails, responsive phone/PC capture.
- **Next:** integrate into the Lovable site.
- **Future:** opt-in learning loop — the classifier graduates toward a **standalone skin-analysis model** that can carry the primary analysis itself, with the LLM demoted to critique/fallback. Consent- and version-gated throughout.

## License

TBD.
