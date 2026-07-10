# AI Skin Analysis — Clinic Edition

A local, privacy-first skin analysis tool for a clinic. Staff scan a patient's skin with the laptop or phone camera (or upload a photo); two independent AI analyses produce a detailed structured report; results and compressed photos are stored **per patient, locally** with full history and before/after comparison.

> **Not a diagnostic device.** This tool is a clinical aid. It never diagnoses, never prescribes treatment, and never determines whether something is cancerous. Every result points to professional care where appropriate.

## Status

Prototype in active development. Plans 1–2 (capture flow + on-device ML) are implemented; the local Docker/Postgres stack and report/history UI are next. See [`docs/superpowers/specs/`](docs/superpowers/specs/) for the spec (v2 — Clinic Edition) and [`docs/superpowers/plans/`](docs/superpowers/plans/) for per-plan folders.

## What it does

- **Guided capture** — live camera (face mode or body close-up) or photo upload, on desktop or phones on the clinic LAN; EXIF/GPS stripped from uploads.
- **Quality gate** — on-device checks (lighting, sharpness, region) refuse unusable images with actionable guidance instead of guessing.
- **Dual-AI analysis** — an on-device ONNX classifier gives an independent second opinion while Claude performs the detailed analysis plus a critique pass; agreement raises confidence, disagreement is flagged, lesion red-flags always escalate to "see a professional."
- **Detailed report** — modeled on professional analyzer vocabulary (hydration, oil, pigmentation, spots, pores, blackheads, wrinkles/texture, acne, inflammation, redness, sensitivity, elasticity appearance, skin type + approximate Fitzpatrick tone), zone-tagged on a facial map. Hardware-style measurements are honestly labeled **visual proxies** — a camera cannot do spectral imaging.
- **Patient records & history** — full patient profiles; every scan stored with its report and a compressed JPEG (downscaled ~1280px, ~100–300 KB); timeline with thumbnails; before/after comparison; PDF export.
- **Local & portable** — everything lives in a Dockerized Postgres on the clinic laptop. Move clinics/laptops with one database dump. History and records work fully offline; only new AI analyses need internet (offline scans are stored as "partial" and can be re-analyzed later).
- **Access-controlled** — single shared clinic password gates the app.

## Architecture (at a glance)

```
CLINIC LAPTOP (Docker Compose)
├── web  — nginx serving the React app
├── api  — Node: auth, analysis pipeline (Claude + critique + guardrails),
│           JPEG compression, Postgres access, holds the API key
└── db   — Postgres 16 (patients, scans w/ images + reports), named volume

Browser (laptop / LAN phones) → web → api → db
                        api → Anthropic API (internet, analysis only)
```

On-device ML (MediaPipe quality gate + ONNX classifier in a web worker) runs in the browser before anything is sent.

- **Frontend:** React + Vite + TypeScript + Tailwind (portable feature module under `frontend/src/features/skin-analysis/`)
- **Server:** Node api container; provider adapter keeps the LLM swappable via env
- **Storage:** Postgres; images as compressed JPEG `bytea`, reports as JSONB

## Privacy & safety

- Per-patient, versioned **consent workflow** before first scan.
- All data stored **only** in the clinic's local database; the AI call is transient (no image retention or logging).
- Real deletion per patient and per scan.
- LLM guardrails: schema-validated output, no diagnosis/prescription language, mandatory non-diagnosis disclaimer, escalation wording on red flags.

## Development

```bash
npm install
npm run dev      # frontend dev server
npm run verify   # typecheck + tests + build
```

Docker stack, backup/restore (`make backup` / `make restore`), and deployment docs land with Plan 4.

## License

TBD.
