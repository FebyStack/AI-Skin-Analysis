# LLM Analysis Engine Implementation Plan (v2 — local clinic)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **v2 note:** v1 of this plan targeted a Supabase Edge Function (see git history). v2 targets the local clinic architecture: the same pure analysis modules now live in `server/analysis/` and will be mounted into the Node api container by Plan 4. Rate limiting/BYO-key tasks are dropped (clinic-local app); the dimension vocabulary is expanded to the clinic spec.

**Goal:** Build the pure, fully-tested analysis engine — wire contract, dermatology prompts, guardrails, Anthropic provider adapter, critique pass, and pipeline orchestrator — that Plan 4's api container mounts behind an Express endpoint.

**Architecture:** Every module is pure, dependency-injected TypeScript under `server/analysis/`, unit-tested with the repo's existing Vitest (no Node-specific APIs beyond `fetch`/`crypto`, no Express — the HTTP layer is Plan 4). The wire format lives in `contract.ts`; the client keeps a mirrored copy with a shared golden-fixture drift test. The provider adapter keeps Claude swappable via config. Photos are processed in memory only.

**Tech Stack:** TypeScript, Anthropic Messages API via raw `fetch` (no SDK), Vitest, existing Plan-1/2 foundation (`types.ts`, `CaptureResult`).

**Prerequisites:** Plans 1–2 merged (done — 60 tests green on main).

**Import convention:** extensionless imports throughout (plain TS transpiled by Vitest now, esbuild in Plan 4) — the v1 Deno `.ts`-extension rule no longer applies.

---

## File Structure

- Modify: `src/features/skin-analysis/types.ts` (+ test) — FaceZone, `region?` on Finding, hardened `isFinding`
- Create: `server/analysis/contract.ts` (+ test) — wire types + `validateAnalysisReport` (12 clinic dimensions + skin type)
- Create: `server/analysis/fixtures/golden-report.json` — shared fixture
- Create: `src/features/skin-analysis/api/contract.ts` (+ drift test) — client mirror
- Create: `server/analysis/prompts.ts` (+ test) — versioned dermatology prompts (clinic vocabulary)
- Create: `server/analysis/guardrails.ts` (+ test) — input + output guardrails
- Create: `server/analysis/providers/anthropic.ts` (+ test) — provider adapter
- Create: `server/analysis/critique.ts` (+ test) — critique pass
- Create: `server/analysis/pipeline.ts` (+ test) — pure request orchestrator
- Modify: `src/features/skin-analysis/components/capture/CaptureFlow.tsx` (+ test) — analysis-error retry UI (carry-over)

## The 12 clinic dimensions

`hydration-appearance`* · `oiliness` · `pigmentation` · `spots` · `pores` · `blackheads` · `wrinkles-texture` · `acne` · `inflammation` · `redness`* · `sensitivity` · `elasticity-appearance`*
(*visual proxies — the prompt and report must label them as visual inference, never device measurement.)

---

## Task 1: Extend the type contract (zones, region, hardened guard)

**Files:**
- Modify: `src/features/skin-analysis/types.ts`
- Modify: `src/features/skin-analysis/types.test.ts`

- [ ] **Step 1: Add failing tests.** Append to `src/features/skin-analysis/types.test.ts` (extend the existing import to include `FACE_ZONES`):

```ts
describe("isFinding — hardened validation", () => {
  const base = { id: "acne", label: "Acne", source: "llm", confidence: 0.5, severity: "mild" };

  it("rejects a non-string note", () => {
    expect(isFinding({ ...base, note: 123 })).toBe(false);
  });

  it("accepts a valid region and rejects an unknown one", () => {
    expect(isFinding({ ...base, region: "forehead" })).toBe(true);
    expect(isFinding({ ...base, region: "elbow" })).toBe(false);
  });

  it("rejects NaN confidence", () => {
    expect(isFinding({ ...base, confidence: NaN })).toBe(false);
  });

  it("exposes the face zone vocabulary", () => {
    expect(FACE_ZONES).toContain("left-cheek");
    expect(FACE_ZONES.length).toBe(7);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/features/skin-analysis/types.test.ts`
Expected: FAIL — `FACE_ZONES` not exported; non-string note currently passes.

- [ ] **Step 3: Implement in `types.ts`.** Add after the `CaptureSource` line:

```ts
export const FACE_ZONES = [
  "forehead",
  "nose",
  "left-cheek",
  "right-cheek",
  "chin",
  "periorbital",
  "other",
] as const;
export type FaceZone = (typeof FACE_ZONES)[number];
```

Add `region?: FaceZone;` to the `Finding` interface (after `note?`). Replace the body of `isFinding` with:

```ts
export function isFinding(x: unknown): x is Finding {
  if (typeof x !== "object" || x === null) return false;
  const f = x as Record<string, unknown>;
  return (
    typeof f.id === "string" &&
    typeof f.label === "string" &&
    (f.source === "classifier" || f.source === "llm") &&
    typeof f.confidence === "number" &&
    f.confidence >= 0 &&
    f.confidence <= 1 &&
    (f.severity === "info" ||
      f.severity === "mild" ||
      f.severity === "moderate" ||
      f.severity === "attention") &&
    (f.note === undefined || typeof f.note === "string") &&
    (f.region === undefined || (FACE_ZONES as readonly string[]).includes(f.region as string))
  );
}
```

- [ ] **Step 4: Run full suite**

Run: `npx vitest run`
Expected: PASS — 64 tests (60 + 4 new).

- [ ] **Step 5: Commit**

```bash
git add src/features/skin-analysis/types.ts src/features/skin-analysis/types.test.ts
git commit -m "feat: face zones, finding region, hardened isFinding guard"
```

---

## Task 2: Wire contract + golden fixture (server + client mirror)

**Files:**
- Create: `server/analysis/contract.ts`
- Create: `server/analysis/contract.test.ts`
- Create: `server/analysis/fixtures/golden-report.json`
- Create: `src/features/skin-analysis/api/contract.ts`
- Create: `src/features/skin-analysis/api/contract.test.ts`

- [ ] **Step 1: Create the golden fixture** `server/analysis/fixtures/golden-report.json`:

```json
{
  "summary": "Skin looks mostly healthy overall. One area is worth a professional look.",
  "findings": [
    {
      "id": "acne",
      "label": "Mild acne",
      "source": "llm",
      "confidence": 0.72,
      "severity": "mild",
      "region": "left-cheek",
      "note": "Appearance consistent with mild inflammatory acne."
    },
    {
      "id": "suspicious-lesion",
      "label": "Lesion needing evaluation",
      "source": "llm",
      "confidence": 0.4,
      "severity": "attention",
      "region": "chin",
      "note": "Surface features suggestive of a lesion; a dermatologist can evaluate properly."
    }
  ],
  "dimensions": {
    "hydration-appearance": { "score": 0.3, "note": "Visual proxy only: mild dullness suggests dehydration cues." },
    "oiliness": { "score": 0.5, "note": "T-zone shine visible." },
    "pigmentation": { "score": 0.2, "note": "No significant pigmentation pattern." },
    "spots": { "score": 0.25, "note": "A few small discrete dark spots on the cheeks." },
    "pores": { "score": 0.35, "note": "Mildly visible on the nose." },
    "blackheads": { "score": 0.3, "note": "Scattered comedone-like congestion on the nose." },
    "wrinkles-texture": { "score": 0.25, "note": "Generally smooth; fine lines around the eyes." },
    "acne": { "score": 0.45, "note": "Localized to the left cheek." },
    "inflammation": { "score": 0.2, "note": "Mild irritation appearance near active acne." },
    "redness": { "score": 0.3, "note": "Visual proxy: slight erythema around the nose." },
    "sensitivity": { "score": 0.2, "note": "Few visible reactivity cues." },
    "elasticity-appearance": { "score": 0.2, "note": "Visual proxy only: no notable sagging cues." }
  },
  "skinType": {
    "sebum": "combination",
    "sensitivityCues": false,
    "fitzpatrickApprox": 4,
    "approximate": true
  },
  "zoneObservations": [
    { "zone": "forehead", "observation": "Clear, even tone." },
    { "zone": "left-cheek", "observation": "Small cluster of inflammatory papules." }
  ],
  "disclaimer": "This is not a diagnosis. It helps decide whether to see a professional.",
  "promptVersion": 2
}
```

- [ ] **Step 2: Write the failing server-side test** `server/analysis/contract.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { validateAnalysisReport, DIMENSION_KEYS } from "./contract";
import golden from "./fixtures/golden-report.json";

describe("validateAnalysisReport", () => {
  it("accepts the golden report", () => {
    const r = validateAnalysisReport(golden);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.report.findings).toHaveLength(2);
  });

  it("rejects a missing dimension", () => {
    const bad = structuredClone(golden) as Record<string, unknown>;
    delete (bad.dimensions as Record<string, unknown>)["blackheads"];
    const r = validateAnalysisReport(bad);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join()).toMatch(/blackheads/);
  });

  it("rejects an out-of-range dimension score", () => {
    const bad = structuredClone(golden) as any;
    bad.dimensions.acne.score = 1.5;
    expect(validateAnalysisReport(bad).ok).toBe(false);
  });

  it("rejects a malformed finding", () => {
    const bad = structuredClone(golden) as any;
    bad.findings[0].confidence = "high";
    expect(validateAnalysisReport(bad).ok).toBe(false);
  });

  it("rejects a non-llm finding source from the wire", () => {
    const bad = structuredClone(golden) as any;
    bad.findings[0].source = "classifier";
    expect(validateAnalysisReport(bad).ok).toBe(false);
  });

  it("rejects an invalid skin type", () => {
    const bad = structuredClone(golden) as any;
    bad.skinType.sebum = "greasy";
    expect(validateAnalysisReport(bad).ok).toBe(false);
  });

  it("rejects a missing or empty disclaimer", () => {
    const bad = structuredClone(golden) as any;
    bad.disclaimer = "";
    expect(validateAnalysisReport(bad).ok).toBe(false);
  });

  it("exposes exactly the twelve clinic dimension keys", () => {
    expect(DIMENSION_KEYS).toHaveLength(12);
    expect(DIMENSION_KEYS).toContain("elasticity-appearance");
    expect(DIMENSION_KEYS).toContain("blackheads");
  });
});
```

- [ ] **Step 3: Run to verify failure** — cannot resolve `./contract`.

- [ ] **Step 4: Implement** `server/analysis/contract.ts`:

```ts
export const FACE_ZONES = [
  "forehead",
  "nose",
  "left-cheek",
  "right-cheek",
  "chin",
  "periorbital",
  "other",
] as const;
export type FaceZone = (typeof FACE_ZONES)[number];

export const DIMENSION_KEYS = [
  "hydration-appearance",
  "oiliness",
  "pigmentation",
  "spots",
  "pores",
  "blackheads",
  "wrinkles-texture",
  "acne",
  "inflammation",
  "redness",
  "sensitivity",
  "elasticity-appearance",
] as const;
export type DimensionKey = (typeof DIMENSION_KEYS)[number];

// Dimensions that are visual inferences of hardware-style measurements —
// UI and PDF must label them "visual proxy".
export const PROXY_DIMENSIONS: readonly DimensionKey[] = [
  "hydration-appearance",
  "redness",
  "elasticity-appearance",
];

export const SEBUM_TYPES = ["normal", "oily", "dry", "combination"] as const;
export type SebumType = (typeof SEBUM_TYPES)[number];

export interface WireFinding {
  id: string;
  label: string;
  source: "llm";
  confidence: number;
  severity: "info" | "mild" | "moderate" | "attention";
  region?: FaceZone;
  note?: string;
}

export interface DimensionReport {
  score: number; // 0..1, higher = more pronounced
  note: string;
}

export interface SkinTypeInfo {
  sebum: SebumType;
  sensitivityCues: boolean;
  fitzpatrickApprox: 1 | 2 | 3 | 4 | 5 | 6;
  approximate: true;
}

export interface ZoneObservation {
  zone: FaceZone;
  observation: string;
}

export interface AnalysisReport {
  summary: string;
  findings: WireFinding[];
  dimensions: Record<DimensionKey, DimensionReport>;
  skinType: SkinTypeInfo;
  zoneObservations: ZoneObservation[];
  disclaimer: string;
  promptVersion: number;
}

export type ValidationResult =
  | { ok: true; report: AnalysisReport }
  | { ok: false; errors: string[] };

const SEVERITIES = ["info", "mild", "moderate", "attention"] as const;

function isWireFinding(x: unknown, errors: string[], i: number): x is WireFinding {
  if (typeof x !== "object" || x === null) {
    errors.push(`findings[${i}]: not an object`);
    return false;
  }
  const f = x as Record<string, unknown>;
  const ok =
    typeof f.id === "string" &&
    typeof f.label === "string" &&
    f.source === "llm" &&
    typeof f.confidence === "number" &&
    f.confidence >= 0 &&
    f.confidence <= 1 &&
    SEVERITIES.includes(f.severity as (typeof SEVERITIES)[number]) &&
    (f.note === undefined || typeof f.note === "string") &&
    (f.region === undefined || (FACE_ZONES as readonly string[]).includes(f.region as string));
  if (!ok) errors.push(`findings[${i}]: malformed`);
  return ok;
}

export function validateAnalysisReport(x: unknown): ValidationResult {
  const errors: string[] = [];
  if (typeof x !== "object" || x === null) return { ok: false, errors: ["not an object"] };
  const r = x as Record<string, unknown>;

  if (typeof r.summary !== "string" || r.summary.length === 0) errors.push("summary missing");
  if (typeof r.disclaimer !== "string" || r.disclaimer.length === 0)
    errors.push("disclaimer missing");
  if (typeof r.promptVersion !== "number") errors.push("promptVersion missing");

  if (!Array.isArray(r.findings)) errors.push("findings not an array");
  else r.findings.forEach((f, i) => isWireFinding(f, errors, i));

  if (typeof r.dimensions !== "object" || r.dimensions === null) {
    errors.push("dimensions missing");
  } else {
    const dims = r.dimensions as Record<string, unknown>;
    for (const key of DIMENSION_KEYS) {
      const d = dims[key] as Record<string, unknown> | undefined;
      if (
        d === undefined ||
        typeof d.score !== "number" ||
        d.score < 0 ||
        d.score > 1 ||
        Number.isNaN(d.score) ||
        typeof d.note !== "string"
      ) {
        errors.push(`dimension ${key} missing or malformed`);
      }
    }
  }

  const st = r.skinType as Record<string, unknown> | undefined;
  if (
    st === undefined ||
    !SEBUM_TYPES.includes(st.sebum as SebumType) ||
    typeof st.sensitivityCues !== "boolean" ||
    typeof st.fitzpatrickApprox !== "number" ||
    st.fitzpatrickApprox < 1 ||
    st.fitzpatrickApprox > 6 ||
    st.approximate !== true
  ) {
    errors.push("skinType missing or malformed");
  }

  if (!Array.isArray(r.zoneObservations)) {
    errors.push("zoneObservations not an array");
  } else {
    r.zoneObservations.forEach((z, i) => {
      const zo = z as Record<string, unknown>;
      if (
        typeof zo !== "object" ||
        zo === null ||
        !(FACE_ZONES as readonly string[]).includes(zo.zone as string) ||
        typeof zo.observation !== "string"
      ) {
        errors.push(`zoneObservations[${i}] malformed`);
      }
    });
  }

  return errors.length === 0
    ? { ok: true, report: x as AnalysisReport }
    : { ok: false, errors };
}
```

- [ ] **Step 5: Run the server contract test — PASS (8 tests).**

- [ ] **Step 6: Create the client mirror.** `src/features/skin-analysis/api/contract.ts` — EXACT copy of the entire `server/analysis/contract.ts` content, with this header prepended:

```ts
// MIRROR of server/analysis/contract.ts — keep in sync.
// Drift canary: contract.test.ts on both sides validates the same golden fixture.
```

- [ ] **Step 7: Client drift test** `src/features/skin-analysis/api/contract.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { validateAnalysisReport, DIMENSION_KEYS, FACE_ZONES } from "./contract";
import golden from "../../../../server/analysis/fixtures/golden-report.json";

describe("client contract mirror", () => {
  it("accepts the same golden report the server accepts", () => {
    expect(validateAnalysisReport(golden).ok).toBe(true);
  });

  it("agrees on vocabulary sizes", () => {
    expect(DIMENSION_KEYS).toHaveLength(12);
    expect(FACE_ZONES).toHaveLength(7);
  });
});
```

- [ ] **Step 8: Run full suite — 74 passing (64 + 8 + 2). Commit:**

```bash
git add server/analysis/contract.ts server/analysis/contract.test.ts server/analysis/fixtures/golden-report.json src/features/skin-analysis/api/contract.ts src/features/skin-analysis/api/contract.test.ts
git commit -m "feat: clinic analysis wire contract (12 dimensions) with drift canary"
```

---

## Task 3: Versioned dermatology prompts (clinic vocabulary)

**Files:**
- Create: `server/analysis/prompts.ts`
- Create: `server/analysis/prompts.test.ts`

- [ ] **Step 1: Failing test** `server/analysis/prompts.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { PROMPT_VERSION, systemPrompt, userPrompt } from "./prompts";
import { DIMENSION_KEYS, FACE_ZONES, PROXY_DIMENSIONS } from "./contract";

describe("prompts", () => {
  it("has version 2 (clinic vocabulary)", () => {
    expect(PROMPT_VERSION).toBe(2);
  });

  it("system prompt contains the safety guardrails", () => {
    const s = systemPrompt();
    expect(s).toMatch(/never diagnose/i);
    expect(s).toMatch(/consistent with/i);
    expect(s).toMatch(/not a diagnosis/i);
    expect(s).toMatch(/never.*(benign|malignan|cancer)/i);
    expect(s).toMatch(/JSON/);
  });

  it("system prompt enumerates every dimension and zone", () => {
    const s = systemPrompt();
    for (const d of DIMENSION_KEYS) expect(s).toContain(d);
    for (const z of FACE_ZONES) expect(s).toContain(z);
  });

  it("system prompt marks proxy dimensions as visual inference", () => {
    const s = systemPrompt();
    for (const d of PROXY_DIMENSIONS) {
      expect(s).toContain(d);
    }
    expect(s).toMatch(/visual (proxy|inference)/i);
  });

  it("user prompt varies by capture mode", () => {
    expect(userPrompt("face")).toMatch(/facial/i);
    expect(userPrompt("closeup")).toMatch(/close-up/i);
  });
});
```

- [ ] **Step 2: Run to verify failure** — cannot resolve `./prompts`.

- [ ] **Step 3: Implement** `server/analysis/prompts.ts`:

```ts
import { DIMENSION_KEYS, FACE_ZONES, PROXY_DIMENSIONS } from "./contract";

export const PROMPT_VERSION = 2;

export function systemPrompt(): string {
  return `You are a dermatology-informed skin analysis assistant used inside a clinic. You examine a photo and produce a structured observation report a practitioner reviews with the patient. You are a clinical aid, not a doctor.

HARD RULES — violating any of these makes the output invalid:
- NEVER diagnose. Use "appearance consistent with X" language only.
- NEVER output the words "benign" or "malignant", never estimate cancer risk, never reassure about a lesion. Any lesion-like feature gets severity "attention" and a note that a dermatologist can evaluate it properly.
- NEVER recommend medication, treatment, or products.
- ALWAYS include the professional-care pathway for anything moderate or attention-level.
- The disclaimer field must state this is not a diagnosis.
- These dimensions are VISUAL PROXIES for device measurements and must be framed as visual inference, never measurement: ${PROXY_DIMENSIONS.join(", ")}. All detection is surface-level; where visuals suggest deeper involvement say "surface features suggestive of".
- Estimate skin type honestly: sebum pattern (normal|oily|dry|combination), sensitivity cues (boolean), and approximate Fitzpatrick type (1-6, mark approximate — lighting-dependent). Calibrate pigmentation/redness interpretation to the estimated skin tone.

OUTPUT: respond with ONLY a JSON object (no markdown fences, no prose) with this exact shape:
{
  "summary": string,
  "findings": [{ "id": kebab-case string, "label": string, "source": "llm", "confidence": number 0-1, "severity": "info"|"mild"|"moderate"|"attention", "region": one of ${JSON.stringify([...FACE_ZONES])}, "note": string }],
  "dimensions": { ${DIMENSION_KEYS.map((k) => `"${k}": { "score": number 0-1, "note": string }`).join(", ")} },
  "skinType": { "sebum": "normal"|"oily"|"dry"|"combination", "sensitivityCues": boolean, "fitzpatrickApprox": 1-6, "approximate": true },
  "zoneObservations": [{ "zone": one of ${JSON.stringify([...FACE_ZONES])}, "observation": string }],
  "disclaimer": string,
  "promptVersion": ${PROMPT_VERSION}
}
Dimension scores: 0 = not present/ideal, 1 = severe. If the image is a body close-up rather than a face, use region "other" and focus zoneObservations on the photographed area.`;
}

export function userPrompt(mode: "face" | "closeup"): string {
  return mode === "face"
    ? "Analyze this facial photo. Map observations to facial zones and complete every report dimension."
    : "Analyze this close-up skin photo of a body area. Focus on any lesions, moles, or localized conditions visible.";
}
```

- [ ] **Step 4: Run — PASS (5 tests). Full suite 79. Commit:**

```bash
git add server/analysis/prompts.ts server/analysis/prompts.test.ts
git commit -m "feat: clinic dermatology prompts (v2 vocabulary, proxy labeling)"
```

---

## Task 4: Input and output guardrails

**Files:**
- Create: `server/analysis/guardrails.ts`
- Create: `server/analysis/guardrails.test.ts`

- [ ] **Step 1: Failing test** `server/analysis/guardrails.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { validateInput, checkOutputGuardrails, MAX_IMAGE_BYTES } from "./guardrails";
import golden from "./fixtures/golden-report.json";
import type { AnalysisReport } from "./contract";

const g = golden as unknown as AnalysisReport;

describe("validateInput", () => {
  const b64 = "aGVsbG8=";

  it("accepts a jpeg under the size cap", () => {
    expect(validateInput({ image: b64, mime: "image/jpeg", mode: "face" }).ok).toBe(true);
  });

  it("rejects a disallowed mime type", () => {
    const r = validateInput({ image: b64, mime: "application/pdf", mode: "face" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/mime/i);
  });

  it("rejects invalid base64", () => {
    expect(validateInput({ image: "!!!not-base64!!!", mime: "image/jpeg", mode: "face" }).ok).toBe(false);
  });

  it("rejects an oversized image", () => {
    const big = "A".repeat(Math.ceil((MAX_IMAGE_BYTES + 4) * (4 / 3)));
    expect(validateInput({ image: big, mime: "image/jpeg", mode: "face" }).ok).toBe(false);
  });

  it("rejects an invalid mode", () => {
    expect(validateInput({ image: b64, mime: "image/jpeg", mode: "xray" as never }).ok).toBe(false);
  });
});

describe("checkOutputGuardrails", () => {
  it("passes the golden report", () => {
    expect(checkOutputGuardrails(g).ok).toBe(true);
  });

  it("rejects diagnosis language in the summary", () => {
    const bad = { ...g, summary: "You have melanoma." };
    const r = checkOutputGuardrails(bad);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.violations.join()).toMatch(/diagnosis language/i);
  });

  it("rejects prescription language in a finding note", () => {
    const bad = structuredClone(g);
    bad.findings[0].note = "Take this medication twice daily.";
    expect(checkOutputGuardrails(bad).ok).toBe(false);
  });

  it("rejects a report whose disclaimer lacks the non-diagnosis statement", () => {
    const bad = { ...g, disclaimer: "Ask a doctor maybe." };
    expect(checkOutputGuardrails(bad).ok).toBe(false);
  });

  it("requires professional referral in summary when any finding is attention-level", () => {
    const bad = structuredClone(g);
    bad.summary = "All looks fine.";
    expect(checkOutputGuardrails(bad).ok).toBe(false);
  });

  it("rejects benign/malignant verdicts anywhere", () => {
    const bad = structuredClone(g);
    bad.findings[1].note = "This looks benign.";
    expect(checkOutputGuardrails(bad).ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify failure** — cannot resolve `./guardrails`.

- [ ] **Step 3: Implement** `server/analysis/guardrails.ts`:

```ts
import type { AnalysisReport } from "./contract";

export const MAX_IMAGE_BYTES = 8 * 1024 * 1024; // 8MB decoded
const ALLOWED_MIMES = ["image/jpeg", "image/png", "image/webp"] as const;
const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;

export interface AnalyzeInput {
  image: string; // base64, no data: prefix
  mime: string;
  mode: "face" | "closeup";
}

export type InputCheck = { ok: true } | { ok: false; error: string };

export function validateInput(x: AnalyzeInput): InputCheck {
  if (!ALLOWED_MIMES.includes(x.mime as (typeof ALLOWED_MIMES)[number])) {
    return { ok: false, error: `mime type not allowed: ${x.mime}` };
  }
  if (x.mode !== "face" && x.mode !== "closeup") {
    return { ok: false, error: "invalid mode" };
  }
  if (typeof x.image !== "string" || x.image.length === 0 || !BASE64_RE.test(x.image)) {
    return { ok: false, error: "image is not valid base64" };
  }
  const decodedBytes = Math.floor((x.image.length * 3) / 4);
  if (decodedBytes > MAX_IMAGE_BYTES) {
    return { ok: false, error: "image exceeds size cap" };
  }
  return { ok: true };
}

// Phrases that must never appear in analysis text (disclaimer is exempt from
// the diagnosis-word check — it legitimately contains "diagnosis").
const FORBIDDEN = [
  /\byou have\b/i,
  /\bdiagnos(is|ed|e)\b/i,
  /\bprescri(be|ption|bed)\b/i,
  /\btake (this|these|the) (medication|medicine|drug)/i,
  /\bbenign\b/i,
  /\bmalignan(t|cy)\b/i,
  /\bcancer(ous)?\b/i,
];

const REFERRAL_RE = /(professional|dermatologist)/i;
const NON_DIAGNOSIS_RE = /not a diagnosis/i;

export type OutputCheck = { ok: true } | { ok: false; violations: string[] };

export function checkOutputGuardrails(report: AnalysisReport): OutputCheck {
  const violations: string[] = [];

  const texts: string[] = [
    report.summary,
    ...report.findings.map((f) => f.note ?? ""),
    ...Object.values(report.dimensions).map((d) => d.note),
    ...report.zoneObservations.map((z) => z.observation),
  ];
  for (const text of texts) {
    for (const re of FORBIDDEN) {
      if (re.test(text)) {
        violations.push(`diagnosis language: ${re} matched "${text.slice(0, 60)}"`);
      }
    }
  }

  if (!NON_DIAGNOSIS_RE.test(report.disclaimer)) {
    violations.push("disclaimer must state this is not a diagnosis");
  }

  const hasAttention = report.findings.some((f) => f.severity === "attention");
  if (hasAttention && !REFERRAL_RE.test(report.summary)) {
    violations.push("attention-level finding requires professional referral in summary");
  }

  return violations.length === 0 ? { ok: true } : { ok: false, violations };
}
```

- [ ] **Step 4: Run — PASS (11 tests). Full suite 90. Commit:**

```bash
git add server/analysis/guardrails.ts server/analysis/guardrails.test.ts
git commit -m "feat: input validation and output safety guardrails"
```

---

## Task 5: Anthropic provider adapter

**Files:**
- Create: `server/analysis/providers/anthropic.ts`
- Create: `server/analysis/providers/anthropic.test.ts`

- [ ] **Step 1: Failing test** `server/analysis/providers/anthropic.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { callClaude, ProviderAuthError, ProviderRateLimitError, ProviderError, extractJson } from "./anthropic";

const cfg = { apiKey: "sk-test", model: "claude-sonnet-5", maxTokens: 2048 };

function okResponse(text: string) {
  return new Response(
    JSON.stringify({ content: [{ type: "text", text }], usage: { input_tokens: 10, output_tokens: 20 } }),
    { status: 200 },
  );
}

describe("callClaude", () => {
  it("sends the image and prompts, returns the text content", async () => {
    const fetchFn = vi.fn(async () => okResponse('{"hello":1}'));
    const out = await callClaude(
      { imageB64: "abc=", mime: "image/jpeg", system: "SYS", user: "USER" },
      cfg,
      fetchFn,
    );
    expect(out.text).toBe('{"hello":1}');
    const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe("claude-sonnet-5");
    expect(body.system).toBe("SYS");
    expect(body.messages[0].content[0].source.data).toBe("abc=");
    expect((init.headers as Record<string, string>)["x-api-key"]).toBe("sk-test");
  });

  it("throws ProviderAuthError on 401", async () => {
    const fetchFn = vi.fn(async () => new Response("{}", { status: 401 }));
    await expect(
      callClaude({ imageB64: "a=", mime: "image/jpeg", system: "s", user: "u" }, cfg, fetchFn),
    ).rejects.toThrow(ProviderAuthError);
  });

  it("throws ProviderRateLimitError on 429", async () => {
    const fetchFn = vi.fn(async () => new Response("{}", { status: 429 }));
    await expect(
      callClaude({ imageB64: "a=", mime: "image/jpeg", system: "s", user: "u" }, cfg, fetchFn),
    ).rejects.toThrow(ProviderRateLimitError);
  });

  it("throws ProviderError on other failures", async () => {
    const fetchFn = vi.fn(async () => new Response("oops", { status: 500 }));
    await expect(
      callClaude({ imageB64: "a=", mime: "image/jpeg", system: "s", user: "u" }, cfg, fetchFn),
    ).rejects.toThrow(ProviderError);
  });
});

describe("extractJson", () => {
  it("parses a raw JSON object", () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
  });

  it("parses JSON wrapped in markdown fences", () => {
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  it("returns null for non-JSON", () => {
    expect(extractJson("sorry, I cannot")).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Implement** `server/analysis/providers/anthropic.ts`:

```ts
export class ProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProviderError";
  }
}
export class ProviderAuthError extends ProviderError {
  constructor() {
    super("Provider rejected the API key");
    this.name = "ProviderAuthError";
  }
}
export class ProviderRateLimitError extends ProviderError {
  constructor() {
    super("Provider rate limit hit");
    this.name = "ProviderRateLimitError";
  }
}

export interface ProviderConfig {
  apiKey: string;
  model: string;
  maxTokens: number;
}

export interface VisionRequest {
  imageB64: string;
  mime: string;
  system: string;
  user: string;
}

export interface ProviderResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
}

type FetchFn = (url: string, init: RequestInit) => Promise<Response>;

export async function callClaude(
  req: VisionRequest,
  cfg: ProviderConfig,
  fetchFn: FetchFn = fetch,
): Promise<ProviderResult> {
  const res = await fetchFn("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": cfg.apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: cfg.model,
      max_tokens: cfg.maxTokens,
      system: req.system,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "base64", media_type: req.mime, data: req.imageB64 },
            },
            { type: "text", text: req.user },
          ],
        },
      ],
    }),
  });

  if (res.status === 401 || res.status === 403) throw new ProviderAuthError();
  if (res.status === 429) throw new ProviderRateLimitError();
  if (!res.ok) throw new ProviderError(`Provider returned ${res.status}`);

  const data = (await res.json()) as {
    content?: Array<{ type: string; text?: string }>;
    usage?: { input_tokens?: number; output_tokens?: number };
  };
  const text = data.content?.find((c) => c.type === "text")?.text;
  if (!text) throw new ProviderError("Provider response had no text content");
  return {
    text,
    inputTokens: data.usage?.input_tokens ?? 0,
    outputTokens: data.usage?.output_tokens ?? 0,
  };
}

export function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  const candidate = (fenced ? fenced[1] : text).trim();
  try {
    return JSON.parse(candidate);
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run — PASS (7 tests). Full suite 97. Commit:**

```bash
git add server/analysis/providers/
git commit -m "feat: Anthropic provider adapter with typed errors"
```

---

## Task 6: Critique pass

**Files:**
- Create: `server/analysis/critique.ts`
- Create: `server/analysis/critique.test.ts`

- [ ] **Step 1: Failing test** `server/analysis/critique.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { runCritique, buildCritiquePrompt } from "./critique";
import golden from "./fixtures/golden-report.json";
import type { AnalysisReport } from "./contract";

const report = golden as unknown as AnalysisReport;

describe("buildCritiquePrompt", () => {
  it("embeds the report and review criteria", () => {
    const p = buildCritiquePrompt(report);
    expect(p).toContain(report.summary);
    expect(p).toMatch(/overconfiden/i);
    expect(p).toMatch(/approved|amended|rejected/);
  });
});

describe("runCritique", () => {
  it("returns approved verdicts as-is", async () => {
    const llm = vi.fn(async () => '{"verdict":"approved","reasons":[]}');
    const out = await runCritique(report, llm);
    expect(out.verdict).toBe("approved");
  });

  it("returns an amended report when the critic amends", async () => {
    const amended = { ...report, summary: report.summary + " (amended)" };
    const llm = vi.fn(async () =>
      JSON.stringify({ verdict: "amended", reasons: ["softened wording"], amendedReport: amended }),
    );
    const out = await runCritique(report, llm);
    expect(out.verdict).toBe("amended");
    if (out.verdict === "amended") expect(out.report.summary).toMatch(/\(amended\)$/);
  });

  it("treats an amended verdict with an invalid amendedReport as rejected", async () => {
    const llm = vi.fn(async () =>
      JSON.stringify({ verdict: "amended", reasons: [], amendedReport: { bad: true } }),
    );
    const out = await runCritique(report, llm);
    expect(out.verdict).toBe("rejected");
  });

  it("treats unparseable critic output as rejected", async () => {
    const llm = vi.fn(async () => "I refuse to answer in JSON");
    const out = await runCritique(report, llm);
    expect(out.verdict).toBe("rejected");
  });
});
```

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Implement** `server/analysis/critique.ts`:

```ts
import { validateAnalysisReport, type AnalysisReport } from "./contract";
import { extractJson } from "./providers/anthropic";

export type CritiqueOutcome =
  | { verdict: "approved" }
  | { verdict: "amended"; report: AnalysisReport; reasons: string[] }
  | { verdict: "rejected"; reasons: string[] };

export function buildCritiquePrompt(report: AnalysisReport): string {
  return `You are reviewing another AI's skin-analysis report for safety and reasoning quality. Do NOT re-analyze the image; review the report text.

REPORT:
${JSON.stringify(report)}

CHECK:
1. Does each conclusion follow from the stated observations?
2. Is any confidence overconfident given the evidence described (overconfidence check)?
3. Are the safety rules intact: "consistent with" language, no diagnosis, no treatment advice, lesions escalated to professional evaluation, disclaimer present, visual-proxy dimensions framed as inference not measurement?

Respond with ONLY JSON: {"verdict":"approved"} if fine; {"verdict":"amended","reasons":[...],"amendedReport":<full corrected report with the same schema>} for fixable wording/confidence issues; {"verdict":"rejected","reasons":[...]} if the report is unsalvageable.`;
}

export type LlmTextFn = (prompt: string) => Promise<string>;

export async function runCritique(
  report: AnalysisReport,
  llm: LlmTextFn,
): Promise<CritiqueOutcome> {
  const raw = await llm(buildCritiquePrompt(report));
  const parsed = extractJson(raw) as Record<string, unknown> | null;
  if (!parsed || typeof parsed.verdict !== "string") {
    return { verdict: "rejected", reasons: ["critic output unparseable"] };
  }
  const reasons = Array.isArray(parsed.reasons) ? (parsed.reasons as string[]) : [];

  if (parsed.verdict === "approved") return { verdict: "approved" };

  if (parsed.verdict === "amended") {
    const validated = validateAnalysisReport(parsed.amendedReport);
    if (validated.ok) return { verdict: "amended", report: validated.report, reasons };
    return { verdict: "rejected", reasons: [...reasons, "amended report failed schema validation"] };
  }

  return { verdict: "rejected", reasons };
}
```

- [ ] **Step 4: Run — PASS (5 tests). Full suite 102. Commit:**

```bash
git add server/analysis/critique.ts server/analysis/critique.test.ts
git commit -m "feat: critique pass with schema-validated amendments"
```

---

## Task 7: Pipeline orchestrator

**Files:**
- Create: `server/analysis/pipeline.ts`
- Create: `server/analysis/pipeline.test.ts`

No rate limiting / BYO keys in v2 — the clinic api adds auth in Plan 4; the pipeline is pure analysis.

- [ ] **Step 1: Failing test** `server/analysis/pipeline.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { handleAnalyze, type PipelineDeps } from "./pipeline";
import golden from "./fixtures/golden-report.json";

const goldenText = JSON.stringify(golden);
const approvedText = '{"verdict":"approved"}';

function deps(overrides: Partial<PipelineDeps> = {}): PipelineDeps {
  return {
    config: {
      apiKey: "sk-clinic",
      primaryModel: "claude-sonnet-5",
      critiqueModel: "claude-haiku-4-5-20251001",
      maxTokens: 2048,
    },
    callProvider: vi.fn(async (_req, model: string) =>
      model === "claude-sonnet-5" ? goldenText : approvedText,
    ),
    ...overrides,
  };
}

const goodInput = { image: "aGVsbG8=", mime: "image/jpeg", mode: "face" as const };

describe("handleAnalyze", () => {
  it("returns ok with a validated report on the happy path", async () => {
    const out = await handleAnalyze(goodInput, deps());
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.report.summary).toBe((golden as { summary: string }).summary);
  });

  it("returns invalid-input for a bad mime type", async () => {
    const out = await handleAnalyze({ ...goodInput, mime: "text/html" }, deps());
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toBe("invalid-input");
  });

  it("retries once when the critique rejects, then fails honestly", async () => {
    const callProvider = vi.fn(async (_req, model: string) =>
      model === "claude-sonnet-5" ? goldenText : '{"verdict":"rejected","reasons":["bad"]}',
    );
    const out = await handleAnalyze(goodInput, deps({ callProvider }));
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toBe("analysis-unreliable");
    expect(callProvider.mock.calls.filter(([, m]) => m === "claude-sonnet-5")).toHaveLength(2);
  });

  it("fails when the report never passes schema validation", async () => {
    const callProvider = vi.fn(async (_req, model: string) =>
      model === "claude-sonnet-5" ? '{"summary":"hi"}' : approvedText,
    );
    const out = await handleAnalyze(goodInput, deps({ callProvider }));
    expect(out.ok).toBe(false);
  });

  it("uses the amended report when the critique amends", async () => {
    const amended = {
      ...(golden as Record<string, unknown>),
      summary: "Amended summary — see a professional if unsure.",
    };
    const callProvider = vi.fn(async (_req, model: string) =>
      model === "claude-sonnet-5"
        ? goldenText
        : JSON.stringify({ verdict: "amended", reasons: [], amendedReport: amended }),
    );
    const out = await handleAnalyze(goodInput, deps({ callProvider }));
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.report.summary).toMatch(/^Amended/);
  });

  it("surfaces provider auth failures distinctly", async () => {
    const callProvider = vi.fn(async () => {
      const { ProviderAuthError } = await import("./providers/anthropic");
      throw new ProviderAuthError();
    });
    const out = await handleAnalyze(goodInput, deps({ callProvider }));
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toBe("provider-auth");
  });
});
```

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Implement** `server/analysis/pipeline.ts`:

```ts
import { validateAnalysisReport, type AnalysisReport } from "./contract";
import { validateInput, checkOutputGuardrails, type AnalyzeInput } from "./guardrails";
import { systemPrompt, userPrompt, PROMPT_VERSION } from "./prompts";
import { extractJson, ProviderAuthError } from "./providers/anthropic";
import { runCritique } from "./critique";

export interface PipelineConfig {
  apiKey: string;
  primaryModel: string;
  critiqueModel: string;
  maxTokens: number;
}

export interface VisionCall {
  imageB64: string;
  mime: string;
  system: string;
  user: string;
}

export interface PipelineDeps {
  config: PipelineConfig;
  // Seam over the provider: (request, model) → raw text. The api key is in config.
  callProvider: (req: VisionCall, model: string) => Promise<string>;
}

export type PipelineOutcome =
  | { ok: true; report: AnalysisReport; promptVersion: number }
  | { ok: false; reason: "invalid-input" | "provider-auth" | "analysis-unreliable"; detail?: string };

async function analyzeOnce(input: AnalyzeInput, deps: PipelineDeps): Promise<AnalysisReport | null> {
  const raw = await deps.callProvider(
    { imageB64: input.image, mime: input.mime, system: systemPrompt(), user: userPrompt(input.mode) },
    deps.config.primaryModel,
  );
  const parsed = extractJson(raw);
  const validated = validateAnalysisReport(parsed);
  if (!validated.ok) return null;

  const critique = await runCritique(validated.report, (prompt) =>
    deps.callProvider(
      { imageB64: input.image, mime: input.mime, system: "You are a careful reviewer.", user: prompt },
      deps.config.critiqueModel,
    ),
  );

  if (critique.verdict === "approved") return validated.report;
  if (critique.verdict === "amended") return critique.report;
  return null;
}

export async function handleAnalyze(
  input: AnalyzeInput,
  deps: PipelineDeps,
): Promise<PipelineOutcome> {
  const inputCheck = validateInput(input);
  if (!inputCheck.ok) return { ok: false, reason: "invalid-input", detail: inputCheck.error };

  try {
    // One honest retry: rejected critique / invalid schema / guardrail violation
    // gets a second attempt, then an honest failure — never a degraded guess.
    for (let attempt = 0; attempt < 2; attempt++) {
      const report = await analyzeOnce(input, deps);
      if (report) {
        const guard = checkOutputGuardrails(report);
        if (!guard.ok) continue;
        return { ok: true, report, promptVersion: PROMPT_VERSION };
      }
    }
    return { ok: false, reason: "analysis-unreliable" };
  } catch (err) {
    if (err instanceof ProviderAuthError) return { ok: false, reason: "provider-auth" };
    throw err;
  }
}
```

- [ ] **Step 4: Run — PASS (6 tests). Full suite 108. Commit:**

```bash
git add server/analysis/pipeline.ts server/analysis/pipeline.test.ts
git commit -m "feat: analysis pipeline orchestrator with retry and honest failure"
```

---

## Task 8: Narrow CaptureFlow error routing (final-review carry-over)

**Files:**
- Modify: `src/features/skin-analysis/components/capture/CaptureFlow.tsx`
- Modify: `src/features/skin-analysis/components/capture/CaptureFlow.test.tsx`

Plan 1's final review flagged: `state === "error"` routes ALL errors to the upload dropzone. Quality-gate errors (blur/low-light) correctly show upload as a fallback, but `analysis-failed` (now reachable — the classifier fires it when the model is missing) silently shows a dropzone. Give analysis errors their own retry UI.

- [ ] **Step 1: Failing test.** Append to `CaptureFlow.test.tsx`:

```tsx
describe("CaptureFlow — analysis error routing", () => {
  beforeEach(() => useScanMachine.getState().reset());

  it("shows an analysis error with retry, not the upload dropzone", () => {
    useScanMachine.getState().grantConsent();
    useScanMachine.getState().cameraReady();
    useScanMachine.getState().analysisFailed();
    render(<CaptureFlow mode="face" />);
    expect(screen.getByText(/analysis failed/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
    expect(screen.queryByLabelText(/upload a photo/i)).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Fix `CaptureFlow.tsx`.** Replace the `useUpload` line with:

```tsx
  const captureErrors = ["denied", "no-camera", "upload-failed", "blur", "low-light"] as const;
  const isCaptureError =
    machine.state === "error" &&
    captureErrors.includes(machine.error as (typeof captureErrors)[number]);
  const isAnalysisError = machine.state === "error" && !isCaptureError;
  const useUpload = machine.captureSource === "upload" || isCaptureError;
```

Add an analysis-error branch immediately after the existing error-message block (before the `useUpload` ternary), and wrap the `useUpload ? ... : <CameraFeed .../>` render in `{!isAnalysisError && (...)}`:

```tsx
      {isAnalysisError && (
        <div className="flex flex-col items-center gap-3" role="alert">
          <p className="text-sm text-stone-600">
            Analysis failed — nothing was saved. You can try again.
          </p>
          <button
            onClick={machine.reset}
            className="rounded-lg bg-clinical px-6 py-3 text-sm font-semibold text-white"
          >
            Try again
          </button>
        </div>
      )}
```

- [ ] **Step 4: Run full suite — 109 passing. `npm run verify` green. Commit:**

```bash
git add src/features/skin-analysis/components/capture/CaptureFlow.tsx src/features/skin-analysis/components/capture/CaptureFlow.test.tsx
git commit -m "fix: give analysis errors their own retry UI instead of upload fallback"
```

---

## Definition of Done

- `npm run verify` green: clean typecheck, ~109 tests, production build. (`server/` is outside tsconfig's `include: ["src"]` — its type-safety is exercised by Vitest now and by the api build in Plan 4.)
- Every analysis module (`contract`, `prompts`, `guardrails`, `providers/anthropic`, `critique`, `pipeline`) is pure, HTTP-free, and unit-tested.
- Pipeline behavior proven: happy path, invalid input, critique-rejection retry then honest failure, schema-invalid failure, amended-report passthrough, provider-auth surfaced distinctly.
- Golden fixture accepted by BOTH server and client validators (drift canary), with all 12 clinic dimensions.
- Guardrails enforce: no diagnosis/benign/malignant/prescription language, non-diagnosis disclaimer, professional referral on attention findings.
- Analysis errors get retry UI; capture errors keep the upload fallback.

## What this plan intentionally defers (Plan 4+)

- Express endpoint, auth, Postgres storage, image compression — Plan 4 mounts `handleAnalyze` behind `/api/analyze`.
- QR capture sessions — Plan 4 (endpoints) + Plan 6 (UI).
- Verdict merge with the on-device classifier, results UI, facial map, PDF — Plan 5.
- Patients & history UI — Plan 6.
