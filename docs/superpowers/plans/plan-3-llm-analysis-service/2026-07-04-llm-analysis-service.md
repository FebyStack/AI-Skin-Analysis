# LLM Analysis Service Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Supabase Edge Function that performs the Claude vision analysis + critique pass behind guardrails and rate limits, plus the client that calls it — delivering the full structured report (findings, facial-map zones, report dimensions, skin type) the spec requires.

**Architecture:** All server logic is written as pure, dependency-injected TypeScript modules under `supabase/functions/analyze/` (unit-tested with the existing Vitest setup — they use no Deno globals), wired together by a thin `index.ts` Deno entry that is not unit-tested. The wire format lives in a `contract.ts` validator; the client keeps a mirrored copy with a shared golden-fixture test as a drift canary. The provider adapter makes Claude swappable via env config; BYO keys bypass rate limits and are never logged. Photos are processed in memory only.

**Tech Stack:** Supabase Edge Functions (Deno), Anthropic Messages API via raw `fetch` (no SDK), Vitest, existing Plan-1 foundation (`types.ts`, `CaptureResult`).

**Import convention (IMPORTANT):** every import between files under `supabase/functions/analyze/` uses an explicit `.ts` extension (e.g. `from "./contract.ts"`) — Deno requires it at deploy time, and Vite/Vitest resolve it fine. Files under `src/` keep the repo's extensionless convention. Test files beside the server modules also use `.ts` extensions for consistency.

**Prerequisites:** Plan 1 merged (done). Plan 2 is NOT required — this service is independent of the on-device classifier; `verdict.ts` merging both opinions is Plan 4.

---

## File Structure

- Modify: `src/features/skin-analysis/types.ts` (+ test) — FaceZone, `region?` on Finding, hardened `isFinding`
- Create: `supabase/functions/analyze/contract.ts` (+ test) — wire types + `validateAnalysisReport`
- Create: `supabase/functions/analyze/fixtures/golden-report.json` — shared fixture
- Create: `src/features/skin-analysis/api/contract.ts` (+ drift test) — client mirror of the wire contract
- Create: `supabase/functions/analyze/prompts.ts` (+ test) — versioned dermatology prompts
- Create: `supabase/functions/analyze/guardrails.ts` (+ test) — input + output guardrails
- Create: `supabase/functions/analyze/providers/anthropic.ts` (+ test) — provider adapter
- Create: `supabase/functions/analyze/critique.ts` (+ test) — critique pass
- Create: `supabase/functions/analyze/rate-limit.ts` (+ test) — hashed-IP limiter + daily cap
- Create: `supabase/functions/analyze/pipeline.ts` (+ test) — pure request orchestrator
- Create: `supabase/functions/analyze/index.ts` — Deno entry (thin, not unit-tested)
- Create: `supabase/functions/analyze/README.md` — env vars + deploy/smoke instructions
- Create: `src/features/skin-analysis/api/analyze-client.ts` (+ test) — browser client

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
Expected: PASS — 37 tests (33 + 4 new).

- [ ] **Step 5: Commit**

```bash
git add src/features/skin-analysis/types.ts src/features/skin-analysis/types.test.ts
git commit -m "feat: face zones, finding region, hardened isFinding guard"
```

---

## Task 2: Wire contract + golden fixture (server side and client mirror)

**Files:**
- Create: `supabase/functions/analyze/contract.ts`
- Create: `supabase/functions/analyze/contract.test.ts`
- Create: `supabase/functions/analyze/fixtures/golden-report.json`
- Create: `src/features/skin-analysis/api/contract.ts`
- Create: `src/features/skin-analysis/api/contract.test.ts`

- [ ] **Step 1: Create the golden fixture** `supabase/functions/analyze/fixtures/golden-report.json`:

```json
{
  "summary": "Your skin looks mostly healthy. One area is worth a professional look.",
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
    "pores": { "score": 0.35, "note": "Mildly visible on the nose." },
    "texture": { "score": 0.25, "note": "Generally smooth." },
    "acne": { "score": 0.45, "note": "Localized to the left cheek." },
    "pigmentation": { "score": 0.2, "note": "No significant pigmentation." },
    "redness": { "score": 0.3, "note": "Slight redness around the nose." },
    "oiliness": { "score": 0.5, "note": "T-zone shine visible." },
    "hydration-appearance": { "score": 0.3, "note": "Visual proxy only: mild dullness." }
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
  "disclaimer": "This is not a diagnosis. It helps you decide whether to see a professional.",
  "promptVersion": 1
}
```

- [ ] **Step 2: Write the failing server-side test** `supabase/functions/analyze/contract.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { validateAnalysisReport, DIMENSION_KEYS } from "./contract.ts";
import golden from "./fixtures/golden-report.json";

describe("validateAnalysisReport", () => {
  it("accepts the golden report", () => {
    const r = validateAnalysisReport(golden);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.report.findings).toHaveLength(2);
  });

  it("rejects a missing dimension", () => {
    const bad = structuredClone(golden) as Record<string, unknown>;
    delete (bad.dimensions as Record<string, unknown>)["pores"];
    const r = validateAnalysisReport(bad);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join()).toMatch(/pores/);
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

  it("exposes exactly the seven dimension keys", () => {
    expect(DIMENSION_KEYS).toHaveLength(7);
    expect(DIMENSION_KEYS).toContain("hydration-appearance");
  });
});
```

- [ ] **Step 3: Run to verify failure** — cannot resolve `./contract`.

- [ ] **Step 4: Implement** `supabase/functions/analyze/contract.ts` (pure TS, no Deno globals — Vitest-testable):

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
  "pores",
  "texture",
  "acne",
  "pigmentation",
  "redness",
  "oiliness",
  "hydration-appearance",
] as const;
export type DimensionKey = (typeof DIMENSION_KEYS)[number];

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

- [ ] **Step 6: Create the client mirror.** `src/features/skin-analysis/api/contract.ts` — EXACT copy of the entire `supabase/functions/analyze/contract.ts` file content, with this header comment prepended:

```ts
// MIRROR of supabase/functions/analyze/contract.ts — keep in sync.
// The drift canary is contract.test.ts on both sides validating the same golden fixture.
```

- [ ] **Step 7: Client drift test** `src/features/skin-analysis/api/contract.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { validateAnalysisReport, DIMENSION_KEYS, FACE_ZONES } from "./contract";
import golden from "../../../../supabase/functions/analyze/fixtures/golden-report.json";

describe("client contract mirror", () => {
  it("accepts the same golden report the server accepts", () => {
    expect(validateAnalysisReport(golden).ok).toBe(true);
  });

  it("agrees on vocabulary sizes with the feature types", () => {
    expect(DIMENSION_KEYS).toHaveLength(7);
    expect(FACE_ZONES).toHaveLength(7);
  });
});
```

- [ ] **Step 8: Run full suite — expect 47 passing (37 + 8 server + 2 client). Then commit:**

```bash
git add supabase/functions/analyze/contract.ts supabase/functions/analyze/contract.test.ts supabase/functions/analyze/fixtures/golden-report.json src/features/skin-analysis/api/contract.ts src/features/skin-analysis/api/contract.test.ts
git commit -m "feat: analysis wire contract with golden-fixture drift canary"
```

---

## Task 3: Versioned dermatology prompts

**Files:**
- Create: `supabase/functions/analyze/prompts.ts`
- Create: `supabase/functions/analyze/prompts.test.ts`

- [ ] **Step 1: Failing test** `supabase/functions/analyze/prompts.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { PROMPT_VERSION, systemPrompt, userPrompt } from "./prompts.ts";
import { DIMENSION_KEYS, FACE_ZONES } from "./contract.ts";

describe("prompts", () => {
  it("has a version number", () => {
    expect(PROMPT_VERSION).toBe(1);
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

  it("user prompt varies by capture mode", () => {
    expect(userPrompt("face")).toMatch(/facial/i);
    expect(userPrompt("closeup")).toMatch(/close-up/i);
  });
});
```

- [ ] **Step 2: Run to verify failure** — cannot resolve `./prompts`.

- [ ] **Step 3: Implement** `supabase/functions/analyze/prompts.ts`:

```ts
import { DIMENSION_KEYS, FACE_ZONES } from "./contract.ts";

export const PROMPT_VERSION = 1;

export function systemPrompt(): string {
  return `You are a dermatology-informed skin analysis assistant. You examine a photo and produce a structured observation report. You are a clinical aid, not a doctor.

HARD RULES — violating any of these makes the output invalid:
- NEVER diagnose. Use "appearance consistent with X" language only.
- NEVER output the words "benign" or "malignant", never estimate cancer risk, never reassure about a lesion. Any lesion-like feature gets severity "attention" and a note that a dermatologist can evaluate it properly.
- NEVER recommend medication, treatment, or products.
- ALWAYS include the professional-care pathway for anything moderate or attention-level.
- The disclaimer field must state this is not a diagnosis.
- Hydration is a VISUAL PROXY only — never claim measured moisture. All detection is surface-level; where visuals suggest deeper involvement say "surface features suggestive of".
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
Dimension scores: 0 = not present/ideal, 1 = severe. If the image is a body close-up rather than a face, use region "other" and leave zoneObservations focused on the photographed area.`;
}

export function userPrompt(mode: "face" | "closeup"): string {
  return mode === "face"
    ? "Analyze this facial photo. Map observations to facial zones and complete every report dimension."
    : "Analyze this close-up skin photo of a body area. Focus on any lesions, moles, or localized conditions visible.";
}
```

- [ ] **Step 4: Run — PASS (4 tests). Full suite 51. Commit:**

```bash
git add supabase/functions/analyze/prompts.ts supabase/functions/analyze/prompts.test.ts
git commit -m "feat: versioned dermatology analysis prompts"
```

---

## Task 4: Input and output guardrails

**Files:**
- Create: `supabase/functions/analyze/guardrails.ts`
- Create: `supabase/functions/analyze/guardrails.test.ts`

- [ ] **Step 1: Failing test** `supabase/functions/analyze/guardrails.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { validateInput, checkOutputGuardrails, MAX_IMAGE_BYTES } from "./guardrails.ts";
import golden from "./fixtures/golden-report.json";
import type { AnalysisReport } from "./contract.ts";

const g = golden as unknown as AnalysisReport;

describe("validateInput", () => {
  const b64 = "aGVsbG8="; // valid base64

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
    // golden has an attention finding, so a summary without referral must fail
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

- [ ] **Step 3: Implement** `supabase/functions/analyze/guardrails.ts`:

```ts
import type { AnalysisReport } from "./contract.ts";

export const MAX_IMAGE_BYTES = 8 * 1024 * 1024; // 8MB decoded
const ALLOWED_MIMES = ["image/jpeg", "image/png", "image/webp"] as const;
const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;

export interface AnalyzeInput {
  image: string; // base64, no data: prefix
  mime: string;
  mode: "face" | "closeup";
  byoKey?: string;
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

// Phrases that must never appear in user-facing analysis text.
const FORBIDDEN = [
  /\byou have\b/i,
  /\bdiagnos(is|ed|e)\b/i, // checked on analysis text, NOT the disclaimer
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

- [ ] **Step 4: Run — PASS (11 tests). Full suite 62. Commit:**

```bash
git add supabase/functions/analyze/guardrails.ts supabase/functions/analyze/guardrails.test.ts
git commit -m "feat: input validation and output safety guardrails"
```

---

## Task 5: Anthropic provider adapter

**Files:**
- Create: `supabase/functions/analyze/providers/anthropic.ts`
- Create: `supabase/functions/analyze/providers/anthropic.test.ts`

- [ ] **Step 1: Failing test** `supabase/functions/analyze/providers/anthropic.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { callClaude, ProviderAuthError, ProviderRateLimitError, ProviderError, extractJson } from "./anthropic.ts";

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

- [ ] **Step 3: Implement** `supabase/functions/analyze/providers/anthropic.ts`:

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

- [ ] **Step 4: Run — PASS (7 tests). Full suite 69. Commit:**

```bash
git add supabase/functions/analyze/providers/
git commit -m "feat: Anthropic provider adapter with typed errors"
```

---

## Task 6: Critique pass

**Files:**
- Create: `supabase/functions/analyze/critique.ts`
- Create: `supabase/functions/analyze/critique.test.ts`

- [ ] **Step 1: Failing test** `supabase/functions/analyze/critique.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { runCritique, buildCritiquePrompt } from "./critique.ts";
import golden from "./fixtures/golden-report.json";
import type { AnalysisReport } from "./contract.ts";

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

- [ ] **Step 3: Implement** `supabase/functions/analyze/critique.ts`:

```ts
import { validateAnalysisReport, type AnalysisReport } from "./contract.ts";
import { extractJson } from "./providers/anthropic.ts";

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
3. Are the safety rules intact: "consistent with" language, no diagnosis, no treatment advice, lesions escalated to professional evaluation, disclaimer present?

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

- [ ] **Step 4: Run — PASS (5 tests). Full suite 74. Commit:**

```bash
git add supabase/functions/analyze/critique.ts supabase/functions/analyze/critique.test.ts
git commit -m "feat: critique pass with schema-validated amendments"
```

---

## Task 7: Rate limiting and daily cap

**Files:**
- Create: `supabase/functions/analyze/rate-limit.ts`
- Create: `supabase/functions/analyze/rate-limit.test.ts`

- [ ] **Step 1: Failing test** `supabase/functions/analyze/rate-limit.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { MemoryCounterStore, checkRateLimit, checkDailyCap, hashIp } from "./rate-limit.ts";

describe("hashIp", () => {
  it("is deterministic and salt-sensitive", async () => {
    const a = await hashIp("1.2.3.4", "salt");
    const b = await hashIp("1.2.3.4", "salt");
    const c = await hashIp("1.2.3.4", "other-salt");
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("checkRateLimit", () => {
  it("allows up to the limit within a window and then blocks", async () => {
    const store = new MemoryCounterStore();
    const now = 1_700_000_000_000;
    for (let i = 0; i < 3; i++) {
      expect((await checkRateLimit("iphash", 3, store, now)).allowed).toBe(true);
    }
    expect((await checkRateLimit("iphash", 3, store, now)).allowed).toBe(false);
  });

  it("resets in the next hourly window", async () => {
    const store = new MemoryCounterStore();
    const now = 1_700_000_000_000;
    await checkRateLimit("iphash", 1, store, now);
    expect((await checkRateLimit("iphash", 1, store, now)).allowed).toBe(false);
    const nextHour = now + 3_600_000;
    expect((await checkRateLimit("iphash", 1, store, nextHour)).allowed).toBe(true);
  });
});

describe("checkDailyCap", () => {
  it("blocks once the global daily cap is reached", async () => {
    const store = new MemoryCounterStore();
    const now = 1_700_000_000_000;
    expect((await checkDailyCap(2, store, now)).allowed).toBe(true);
    expect((await checkDailyCap(2, store, now)).allowed).toBe(true);
    expect((await checkDailyCap(2, store, now)).allowed).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Implement** `supabase/functions/analyze/rate-limit.ts`:

```ts
// Counter store seam: MemoryCounterStore is per-isolate (fine for prototype;
// documented limitation — swap for a Supabase-table store for durable limits).
export interface CounterStore {
  incr(key: string): Promise<number>; // returns the new count
}

export class MemoryCounterStore implements CounterStore {
  private counts = new Map<string, number>();
  async incr(key: string): Promise<number> {
    const next = (this.counts.get(key) ?? 0) + 1;
    this.counts.set(key, next);
    return next;
  }
}

export async function hashIp(ip: string, salt: string): Promise<string> {
  const data = new TextEncoder().encode(`${salt}:${ip}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export interface LimitResult {
  allowed: boolean;
}

export async function checkRateLimit(
  ipHash: string,
  perHour: number,
  store: CounterStore,
  nowMs: number,
): Promise<LimitResult> {
  const window = Math.floor(nowMs / 3_600_000);
  const count = await store.incr(`rl:${ipHash}:${window}`);
  return { allowed: count <= perHour };
}

export async function checkDailyCap(
  maxPerDay: number,
  store: CounterStore,
  nowMs: number,
): Promise<LimitResult> {
  const day = Math.floor(nowMs / 86_400_000);
  const count = await store.incr(`day:${day}`);
  return { allowed: count <= maxPerDay };
}
```

- [ ] **Step 4: Run — PASS (4 tests). Full suite 78. Commit:**

```bash
git add supabase/functions/analyze/rate-limit.ts supabase/functions/analyze/rate-limit.test.ts
git commit -m "feat: hashed-IP rate limiting and global daily cap"
```

---

## Task 8: The pipeline orchestrator

**Files:**
- Create: `supabase/functions/analyze/pipeline.ts`
- Create: `supabase/functions/analyze/pipeline.test.ts`

- [ ] **Step 1: Failing test** `supabase/functions/analyze/pipeline.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { handleAnalyze, type PipelineDeps } from "./pipeline.ts";
import { MemoryCounterStore } from "./rate-limit.ts";
import golden from "./fixtures/golden-report.json";

const goldenText = JSON.stringify(golden);
const approvedText = '{"verdict":"approved"}';

function deps(overrides: Partial<PipelineDeps> = {}): PipelineDeps {
  return {
    config: {
      apiKey: "sk-operator",
      primaryModel: "claude-sonnet-5",
      critiqueModel: "claude-haiku-4-5-20251001",
      maxTokens: 2048,
      rateLimitPerHour: 10,
      maxScansPerDay: 100,
      ipHashSalt: "salt",
    },
    counters: new MemoryCounterStore(),
    now: () => 1_700_000_000_000,
    // callProvider(model, apiKey) → text. Primary returns the report; critique approves.
    callProvider: vi.fn(async (_req, model: string) =>
      model === "claude-sonnet-5" ? goldenText : approvedText,
    ),
    ...overrides,
  };
}

const goodInput = { image: "aGVsbG8=", mime: "image/jpeg", mode: "face" as const };

describe("handleAnalyze", () => {
  it("returns 200 with a validated report on the happy path", async () => {
    const out = await handleAnalyze(goodInput, "1.2.3.4", deps());
    expect(out.status).toBe(200);
    expect((out.body as { report: { summary: string } }).report.summary).toBe(
      (golden as { summary: string }).summary,
    );
  });

  it("returns 400 for a bad mime type", async () => {
    const out = await handleAnalyze({ ...goodInput, mime: "text/html" }, "1.2.3.4", deps());
    expect(out.status).toBe(400);
  });

  it("returns 429 when the per-IP limit is exhausted", async () => {
    const d = deps({ config: { ...deps().config, rateLimitPerHour: 1 } });
    await handleAnalyze(goodInput, "1.2.3.4", d);
    const out = await handleAnalyze(goodInput, "1.2.3.4", d);
    expect(out.status).toBe(429);
  });

  it("bypasses rate limiting with a BYO key and uses it for the provider call", async () => {
    const d = deps({ config: { ...deps().config, rateLimitPerHour: 0, maxScansPerDay: 0 } });
    const out = await handleAnalyze({ ...goodInput, byoKey: "sk-user" }, "1.2.3.4", d);
    expect(out.status).toBe(200);
    const calls = (d.callProvider as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls.every(([, , key]) => key === "sk-user")).toBe(true);
  });

  it("retries once when the critique rejects, then fails honestly", async () => {
    const callProvider = vi.fn(async (_req, model: string) =>
      model === "claude-sonnet-5" ? goldenText : '{"verdict":"rejected","reasons":["bad"]}',
    );
    const out = await handleAnalyze(goodInput, "1.2.3.4", deps({ callProvider }));
    expect(out.status).toBe(502);
    // 2 primary + 2 critique calls = one retry
    expect(callProvider.mock.calls.filter(([, m]) => m === "claude-sonnet-5")).toHaveLength(2);
  });

  it("returns 502 when the report fails schema validation", async () => {
    const callProvider = vi.fn(async (_req, model: string) =>
      model === "claude-sonnet-5" ? '{"summary":"hi"}' : approvedText,
    );
    const out = await handleAnalyze(goodInput, "1.2.3.4", deps({ callProvider }));
    expect(out.status).toBe(502);
  });

  it("uses the amended report when the critique amends", async () => {
    const amended = { ...(golden as Record<string, unknown>), summary: "Amended summary — see a professional if unsure." };
    const callProvider = vi.fn(async (_req, model: string) =>
      model === "claude-sonnet-5"
        ? goldenText
        : JSON.stringify({ verdict: "amended", reasons: [], amendedReport: amended }),
    );
    const out = await handleAnalyze(goodInput, "1.2.3.4", deps({ callProvider }));
    expect(out.status).toBe(200);
    expect((out.body as { report: { summary: string } }).report.summary).toMatch(/^Amended/);
  });
});
```

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Implement** `supabase/functions/analyze/pipeline.ts`:

```ts
import { validateAnalysisReport, type AnalysisReport } from "./contract.ts";
import { validateInput, checkOutputGuardrails, type AnalyzeInput } from "./guardrails.ts";
import { systemPrompt, userPrompt, PROMPT_VERSION } from "./prompts.ts";
import { extractJson } from "./providers/anthropic.ts";
import { runCritique } from "./critique.ts";
import { checkRateLimit, checkDailyCap, hashIp, type CounterStore } from "./rate-limit.ts";

export interface PipelineConfig {
  apiKey: string;
  primaryModel: string;
  critiqueModel: string;
  maxTokens: number;
  rateLimitPerHour: number;
  maxScansPerDay: number;
  ipHashSalt: string;
}

export interface VisionCall {
  imageB64: string;
  mime: string;
  system: string;
  user: string;
}

export interface PipelineDeps {
  config: PipelineConfig;
  counters: CounterStore;
  now: () => number;
  // Seam over the provider: (request, model, apiKey) → raw text.
  callProvider: (req: VisionCall, model: string, apiKey: string) => Promise<string>;
}

export interface PipelineResult {
  status: number;
  body: unknown;
}

async function analyzeOnce(
  input: AnalyzeInput,
  apiKey: string,
  deps: PipelineDeps,
): Promise<AnalysisReport | null> {
  const raw = await deps.callProvider(
    { imageB64: input.image, mime: input.mime, system: systemPrompt(), user: userPrompt(input.mode) },
    deps.config.primaryModel,
    apiKey,
  );
  const parsed = extractJson(raw);
  const validated = validateAnalysisReport(parsed);
  if (!validated.ok) return null;

  const critique = await runCritique(validated.report, (prompt) =>
    deps.callProvider(
      { imageB64: input.image, mime: input.mime, system: "You are a careful reviewer.", user: prompt },
      deps.config.critiqueModel,
      apiKey,
    ),
  );

  if (critique.verdict === "approved") return validated.report;
  if (critique.verdict === "amended") return critique.report;
  return null;
}

export async function handleAnalyze(
  input: AnalyzeInput,
  ip: string,
  deps: PipelineDeps,
): Promise<PipelineResult> {
  const inputCheck = validateInput(input);
  if (!inputCheck.ok) return { status: 400, body: { error: inputCheck.error } };

  const usingByoKey = typeof input.byoKey === "string" && input.byoKey.length > 0;
  if (!usingByoKey) {
    const ipHash = await hashIp(ip, deps.config.ipHashSalt);
    const rl = await checkRateLimit(ipHash, deps.config.rateLimitPerHour, deps.counters, deps.now());
    if (!rl.allowed) return { status: 429, body: { error: "rate limit exceeded — try later" } };
    const cap = await checkDailyCap(deps.config.maxScansPerDay, deps.counters, deps.now());
    if (!cap.allowed) return { status: 429, body: { error: "daily capacity reached — try tomorrow" } };
  }

  const apiKey = usingByoKey ? (input.byoKey as string) : deps.config.apiKey;

  // One honest retry: a rejected critique or invalid schema gets a second attempt, then 502.
  for (let attempt = 0; attempt < 2; attempt++) {
    const report = await analyzeOnce(input, apiKey, deps);
    if (report) {
      const guard = checkOutputGuardrails(report);
      if (!guard.ok) continue; // guardrail violation → retry, never show
      return { status: 200, body: { report, promptVersion: PROMPT_VERSION } };
    }
  }
  return { status: 502, body: { error: "analysis could not be completed reliably" } };
}
```

- [ ] **Step 4: Run — PASS (7 tests). Full suite 85. Commit:**

```bash
git add supabase/functions/analyze/pipeline.ts supabase/functions/analyze/pipeline.test.ts
git commit -m "feat: analyze pipeline orchestrator with retry and honest failure"
```

---

## Task 9: Deno entry, env config, and function README

**Files:**
- Create: `supabase/functions/analyze/index.ts`
- Create: `supabase/functions/analyze/README.md`

No unit tests — `index.ts` is the thin Deno shell (uses `Deno.serve`/`Deno.env`, unavailable in Vitest). Its logic lives in the tested `pipeline.ts`.

- [ ] **Step 1: Create `supabase/functions/analyze/index.ts`:**

```ts
// Deno entry — thin shell over the tested pipeline. Not unit-tested by design.
import { handleAnalyze, type PipelineDeps } from "./pipeline.ts";
import { callClaude } from "./providers/anthropic.ts";
import { MemoryCounterStore } from "./rate-limit.ts";
import type { AnalyzeInput } from "./guardrails.ts";

const config = {
  apiKey: Deno.env.get("ANTHROPIC_API_KEY") ?? "",
  primaryModel: Deno.env.get("PRIMARY_MODEL") ?? "claude-sonnet-5",
  critiqueModel: Deno.env.get("CRITIQUE_MODEL") ?? "claude-haiku-4-5-20251001",
  maxTokens: Number(Deno.env.get("MAX_TOKENS") ?? "2048"),
  rateLimitPerHour: Number(Deno.env.get("RATE_LIMIT_PER_HOUR") ?? "10"),
  maxScansPerDay: Number(Deno.env.get("MAX_SCANS_PER_DAY") ?? "200"),
  ipHashSalt: Deno.env.get("IP_HASH_SALT") ?? "dev-salt",
};

const corsHeaders = {
  "Access-Control-Allow-Origin": Deno.env.get("ALLOWED_ORIGIN") ?? "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Per-isolate store: fine for prototype rate limiting; swap for a durable
// Supabase-table CounterStore before scaling (documented in README).
const counters = new MemoryCounterStore();

const deps: PipelineDeps = {
  config,
  counters,
  now: () => Date.now(),
  callProvider: async (req, model, apiKey) => {
    const result = await callClaude(req, { apiKey, model, maxTokens: config.maxTokens });
    return result.text;
  },
};

Deno.serve(async (request: Request): Promise<Response> => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (request.method !== "POST") {
    return new Response(JSON.stringify({ error: "method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "content-type": "application/json" },
    });
  }
  if (!config.apiKey) {
    return new Response(JSON.stringify({ error: "server not configured" }), {
      status: 500,
      headers: { ...corsHeaders, "content-type": "application/json" },
    });
  }

  let input: AnalyzeInput;
  try {
    input = (await request.json()) as AnalyzeInput;
  } catch {
    return new Response(JSON.stringify({ error: "invalid JSON body" }), {
      status: 400,
      headers: { ...corsHeaders, "content-type": "application/json" },
    });
  }

  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const result = await handleAnalyze(input, ip, deps);
  // NOTE: image data and BYO keys are never logged anywhere in this function.
  return new Response(JSON.stringify(result.body), {
    status: result.status,
    headers: { ...corsHeaders, "content-type": "application/json" },
  });
});
```

- [ ] **Step 2: Create `supabase/functions/analyze/README.md`:**

```markdown
# analyze — LLM analysis Edge Function

The only server piece of the app. Receives a base64 photo, runs Claude vision
analysis + a critique pass behind guardrails and rate limits, returns a
validated `AnalysisReport`. Photos are processed in memory only — never stored,
never logged. BYO keys are used for the provider call and never logged.

## Env vars (Supabase dashboard → Edge Functions → secrets)

| Var | Default | Purpose |
|-----|---------|---------|
| `ANTHROPIC_API_KEY` | (required) | Operator's Claude key |
| `PRIMARY_MODEL` | `claude-sonnet-5` | Vision analysis model |
| `CRITIQUE_MODEL` | `claude-haiku-4-5-20251001` | Critique pass model |
| `MAX_TOKENS` | `2048` | Response cap |
| `RATE_LIMIT_PER_HOUR` | `10` | Per-IP scans/hour (skipped for BYO keys) |
| `MAX_SCANS_PER_DAY` | `200` | Global daily kill-switch |
| `IP_HASH_SALT` | `dev-salt` | Salt for hashed-IP counters (set a real one) |
| `ALLOWED_ORIGIN` | `*` | CORS origin (set to the site origin in prod) |

## Known limitation

Rate-limit counters are per-isolate (in-memory). Good enough to blunt abuse in
the prototype; swap `MemoryCounterStore` for a Supabase-table `CounterStore`
implementation before real launch. The seam exists in `rate-limit.ts`.

## Local dev

```bash
supabase functions serve analyze --env-file supabase/.env.local
curl -i http://localhost:54321/functions/v1/analyze \
  -H "content-type: application/json" \
  -d '{"image":"<base64>","mime":"image/jpeg","mode":"face"}'
```

## Deploy

```bash
supabase functions deploy analyze
```

Unit tests live beside the source (`*.test.ts`, run by the repo's Vitest — the
modules are Deno-free; only `index.ts` touches Deno APIs).
```

- [ ] **Step 3: Verify the repo still passes** — `npm run verify` (85 tests; `index.ts` is outside tsconfig's `include: ["src"]` so `tsc` ignores its Deno globals; vite build unaffected).

- [ ] **Step 4: Commit:**

```bash
git add supabase/functions/analyze/index.ts supabase/functions/analyze/README.md
git commit -m "feat: analyze Edge Function entry, env config, and docs"
```

---

## Task 10: Browser analyze client

**Files:**
- Create: `src/features/skin-analysis/api/analyze-client.ts`
- Create: `src/features/skin-analysis/api/analyze-client.test.ts`

- [ ] **Step 1: Failing test** `src/features/skin-analysis/api/analyze-client.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { analyzeCapture, AnalyzeRateLimitedError, AnalyzeFailedError } from "./analyze-client";
import golden from "../../../../supabase/functions/analyze/fixtures/golden-report.json";
import type { CaptureResult } from "../types";

const capture: CaptureResult = {
  blob: new Blob(["fake-jpeg-bytes"], { type: "image/jpeg" }),
  mimeType: "image/jpeg",
  mode: "face",
  source: "camera",
  width: 640,
  height: 480,
};

const endpoint = "https://example.supabase.co/functions/v1/analyze";

describe("analyzeCapture", () => {
  it("posts base64 JSON and returns the validated report", async () => {
    const fetchFn = vi.fn(async () =>
      new Response(JSON.stringify({ report: golden, promptVersion: 1 }), { status: 200 }),
    );
    const report = await analyzeCapture(capture, { endpoint, anonKey: "anon" }, fetchFn);
    expect(report.summary).toBe((golden as { summary: string }).summary);
    const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(endpoint);
    const body = JSON.parse(init.body as string);
    expect(body.mime).toBe("image/jpeg");
    expect(body.mode).toBe("face");
    expect(typeof body.image).toBe("string");
    expect(body.image.length).toBeGreaterThan(0);
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer anon");
  });

  it("includes a BYO key when provided", async () => {
    const fetchFn = vi.fn(async () =>
      new Response(JSON.stringify({ report: golden, promptVersion: 1 }), { status: 200 }),
    );
    await analyzeCapture(capture, { endpoint, anonKey: "anon", byoKey: "sk-user" }, fetchFn);
    const body = JSON.parse((fetchFn.mock.calls[0][1] as RequestInit).body as string);
    expect(body.byoKey).toBe("sk-user");
  });

  it("throws AnalyzeRateLimitedError on 429", async () => {
    const fetchFn = vi.fn(async () => new Response("{}", { status: 429 }));
    await expect(analyzeCapture(capture, { endpoint, anonKey: "anon" }, fetchFn)).rejects.toThrow(
      AnalyzeRateLimitedError,
    );
  });

  it("throws AnalyzeFailedError on 502", async () => {
    const fetchFn = vi.fn(async () => new Response("{}", { status: 502 }));
    await expect(analyzeCapture(capture, { endpoint, anonKey: "anon" }, fetchFn)).rejects.toThrow(
      AnalyzeFailedError,
    );
  });

  it("throws AnalyzeFailedError when the response fails contract validation", async () => {
    const fetchFn = vi.fn(async () =>
      new Response(JSON.stringify({ report: { summary: "only this" } }), { status: 200 }),
    );
    await expect(analyzeCapture(capture, { endpoint, anonKey: "anon" }, fetchFn)).rejects.toThrow(
      AnalyzeFailedError,
    );
  });
});
```

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Implement** `src/features/skin-analysis/api/analyze-client.ts`:

```ts
import { validateAnalysisReport, type AnalysisReport } from "./contract";
import type { CaptureResult } from "../types";

export class AnalyzeRateLimitedError extends Error {
  constructor() {
    super("Too many scans right now — please try again later.");
    this.name = "AnalyzeRateLimitedError";
  }
}
export class AnalyzeFailedError extends Error {
  constructor(message = "The analysis could not be completed. Please try again.") {
    super(message);
    this.name = "AnalyzeFailedError";
  }
}

export interface AnalyzeOptions {
  endpoint: string; // `${SUPABASE_URL}/functions/v1/analyze`
  anonKey: string;
  byoKey?: string;
}

type FetchFn = (url: string, init: RequestInit) => Promise<Response>;

async function blobToBase64(blob: Blob): Promise<string> {
  const dataUrl: string = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
  return dataUrl.slice(dataUrl.indexOf(",") + 1);
}

export async function analyzeCapture(
  capture: CaptureResult,
  opts: AnalyzeOptions,
  fetchFn: FetchFn = fetch,
): Promise<AnalysisReport> {
  const image = await blobToBase64(capture.blob);
  const res = await fetchFn(opts.endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Authorization: `Bearer ${opts.anonKey}`,
      apikey: opts.anonKey,
    },
    body: JSON.stringify({
      image,
      mime: capture.mimeType,
      mode: capture.mode,
      ...(opts.byoKey ? { byoKey: opts.byoKey } : {}),
    }),
  });

  if (res.status === 429) throw new AnalyzeRateLimitedError();
  if (!res.ok) throw new AnalyzeFailedError();

  const data = (await res.json()) as { report?: unknown };
  const validated = validateAnalysisReport(data.report);
  if (!validated.ok) throw new AnalyzeFailedError("The analysis response was malformed.");
  return validated.report;
}

export function defaultAnalyzeOptions(): AnalyzeOptions {
  return {
    endpoint: `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/analyze`,
    anonKey: import.meta.env.VITE_SUPABASE_ANON_KEY as string,
  };
}
```

NOTE: jsdom lacks `FileReader.readAsDataURL` support for Blob in some versions — if the first test fails on `blobToBase64`, add a guarded polyfill to `src/test/setup.ts` following the existing pattern there (localStorage, Blob.text), converting via `Blob.text()`+`btoa`. Report it as a deviation if needed.

- [ ] **Step 4: Add env typing.** Create `src/vite-env.d.ts` if absent:

```ts
/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;
  readonly VITE_CLASSIFIER_MODEL_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
```

- [ ] **Step 5: Run — PASS (5 tests). Then `npm run verify` (90 tests, clean typecheck, build). Commit:**

```bash
git add src/features/skin-analysis/api/analyze-client.ts src/features/skin-analysis/api/analyze-client.test.ts src/vite-env.d.ts
git commit -m "feat: browser analyze client with typed errors"
```

---

## Task 11: Narrow CaptureFlow error routing (final-review carry-over)

**Files:**
- Modify: `src/features/skin-analysis/components/capture/CaptureFlow.tsx`
- Modify: `src/features/skin-analysis/components/capture/CaptureFlow.test.tsx`

Plan 1's final review flagged: `useUpload = captureSource === "upload" || state === "error"` routes ALL errors to the upload dropzone; when analysis errors become reachable they'd silently dump users into upload. Narrow it now.

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

- [ ] **Step 3: Fix `CaptureFlow.tsx`.** Replace the `useUpload` line and the surrounding render with:

```tsx
  const captureErrors = ["denied", "no-camera", "upload-failed"] as const;
  const isCaptureError =
    machine.state === "error" &&
    captureErrors.includes(machine.error as (typeof captureErrors)[number]);
  const isAnalysisError = machine.state === "error" && !isCaptureError;
  const useUpload = machine.captureSource === "upload" || isCaptureError;
```

And add an analysis-error branch before the `useUpload` block in the JSX:

```tsx
      {isAnalysisError && (
        <div className="flex flex-col items-center gap-3" role="alert">
          <p className="text-sm text-stone-600">Analysis failed — nothing was saved. You can try again.</p>
          <button
            onClick={machine.reset}
            className="rounded-lg bg-clinical px-6 py-3 text-sm font-semibold text-white"
          >
            Try again
          </button>
        </div>
      )}
```

Wrap the existing `useUpload ? ... : <CameraFeed .../>` render so it only renders when `!isAnalysisError`.

- [ ] **Step 4: Run full suite — all passing (91). `npm run verify` green. Commit:**

```bash
git add src/features/skin-analysis/components/capture/CaptureFlow.tsx src/features/skin-analysis/components/capture/CaptureFlow.test.tsx
git commit -m "fix: give analysis errors their own retry UI instead of upload fallback"
```

---

## Definition of Done

- `npm run verify` green: clean typecheck, all ~91 tests, production build.
- Every server module (`contract`, `prompts`, `guardrails`, `providers/anthropic`, `critique`, `rate-limit`, `pipeline`) is pure, Deno-free, and unit-tested; `index.ts` is the only Deno-touching file.
- Pipeline behavior proven by tests: happy path, bad input 400, rate-limit 429, BYO-key bypass + key used for provider calls, critique-rejection retry then 502, schema-invalid 502, amended-report passthrough.
- Golden fixture accepted by BOTH server and client validators (drift canary).
- Guardrails enforce: no diagnosis/benign/malignant/prescription language, non-diagnosis disclaimer, professional referral on attention findings.
- No image data or BYO keys logged anywhere.
- Manual smoke (needs Supabase project + real key): `supabase functions serve analyze` + curl per the function README returns a valid report.

## What this plan intentionally defers

- Durable (cross-isolate) rate-limit store — seam exists; swap before public launch.
- Wiring `analyzeCapture` into the UI + loading screen + results — Plan 4.
- Verdict merge with the on-device classifier — Plan 4 (needs Plan 2).
- Facial-map rendering, PDF export, trend analysis — Plan 4/5.
- Tier-1 learning-loop telemetry (opt-in disagreement records) — after Plans 2+4.
