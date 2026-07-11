# Face Pipeline Core Implementation Plan (Plan 10 / Phase A)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use `- [ ]`. Spec: `docs/superpowers/specs/2026-07-10-face-analysis-architecture.md`.

**Goal:** The complete headless analysis core — contracts, zone geometry, quality validation, per-zone pixel stats, 11 dimension analyzers, cross-angle merge, recommendations — fully unit-tested on synthetic fixtures, no UI, no MediaPipe runtime (it's injected data here; live wiring is Phase B).

**Architecture:** One expensive pixel pass per image computes `ZoneStats`; analyzers are tiny pure functions over stats; merge fuses views quality-weighted. Everything under `ai/face/` (browser-safe TS, no DOM required — testable in node env). Types in `shared/face.ts`.

**Tech Stack:** TypeScript, vitest. No new dependencies.

**Conventions:** relative imports inside `ai/`; `@shared` alias only from frontend (ai uses `../../shared/...`); commit per task; run `npx vitest run <file>` per step and the full suite before each commit.

---

### Task 1: Face wire contract (`shared/face.ts`)

**Files:** Create `shared/face.ts` · Test `shared/face.test.ts`

- [ ] **Step 1 — failing test:**

```typescript
// shared/face.test.ts
import { describe, it, expect } from "vitest";
import {
  FACE_ANGLES, FACE_DIMENSIONS, FACE_ANALYSIS_ZONES,
  validateFaceReport, type FaceReport,
} from "./face";

export function goldenFaceReport(): FaceReport {
  const dim = (evidence: string) => ({
    score: 0.4, confidence: 0.8,
    perZone: [{ zone: "forehead" as const, score: 0.4 }],
    evidence,
  });
  return {
    kind: "face-v2",
    overall: { score: 0.45, confidence: 0.8 },
    dimensions: Object.fromEntries(FACE_DIMENSIONS.map((d) => [d, dim(`${d} via zone pixel metrics`)])) as FaceReport["dimensions"],
    capture: { angles: [{ angle: "front", quality: { ok: true, issues: [] } }] },
    recommendations: { skincare: ["Daily broad-spectrum sunscreen."], treatments: [] },
    explanation: null,
    disclaimer: "This is not a diagnosis.",
    pipelineVersion: 1,
    modelVersions: { "face-landmarker": "dev" },
  };
}

describe("face contract", () => {
  it("has 5 required angles and 11 dimensions", () => {
    expect(FACE_ANGLES).toHaveLength(5);
    expect(FACE_DIMENSIONS).toHaveLength(11);
    expect(FACE_ANALYSIS_ZONES).toContain("under-eye");
  });
  it("accepts the golden report", () => {
    expect(validateFaceReport(goldenFaceReport()).ok).toBe(true);
  });
  it("rejects a report missing a dimension", () => {
    const r = goldenFaceReport() as never as Record<string, never>;
    const dims = { ...(r.dimensions as object) } as Record<string, unknown>;
    delete dims["acne"];
    expect(validateFaceReport({ ...goldenFaceReport(), dimensions: dims }).ok).toBe(false);
  });
  it("rejects out-of-range scores", () => {
    const g = goldenFaceReport();
    g.overall.score = 1.5;
    expect(validateFaceReport(g).ok).toBe(false);
  });
});
```

- [ ] **Step 2 — run, see FAIL:** `npx vitest run shared/face.test.ts`
- [ ] **Step 3 — implement:**

```typescript
// shared/face.ts
// Wire contract for whole-face analysis (v3 spec). Frontend renders ONLY these shapes.

export const FACE_ANGLES = ["front", "left-45", "right-45", "left-profile", "right-profile"] as const;
export type FaceAngle = (typeof FACE_ANGLES)[number];
export const OPTIONAL_ANGLES = ["forehead", "chin"] as const;

export const FACE_DIMENSIONS = [
  "acne", "pigmentation", "redness", "texture", "pores", "oiliness",
  "dryness", "fine-lines", "wrinkles", "under-eye", "tone-consistency",
] as const;
export type FaceDimension = (typeof FACE_DIMENSIONS)[number];

export const FACE_ANALYSIS_ZONES = [
  "forehead", "nose", "left-cheek", "right-cheek", "chin", "periorbital", "under-eye",
] as const;
export type FaceAnalysisZone = (typeof FACE_ANALYSIS_ZONES)[number];

export interface DimensionScore {
  score: number;        // 0..1, higher = more pronounced
  confidence: number;   // 0..1
  perZone: { zone: FaceAnalysisZone; score: number }[];
  evidence: string;     // camera-honest: names the pixel metric used
}

export interface AngleQuality { ok: boolean; issues: string[] }

export interface FaceExplanation {
  patientSummary: string;
  education: string;
  source: "gemini" | "builtin";
  promptVersion: number;
}

export interface FaceReport {
  kind: "face-v2";
  overall: { score: number; confidence: number };
  dimensions: Record<FaceDimension, DimensionScore>;
  capture: { angles: { angle: string; quality: AngleQuality }[] };
  recommendations: { skincare: string[]; treatments: string[] };
  explanation: FaceExplanation | null;   // filled in Phase C
  disclaimer: string;
  pipelineVersion: number;
  modelVersions: Record<string, string>;
}

const in01 = (n: unknown): n is number => typeof n === "number" && n >= 0 && n <= 1 && !Number.isNaN(n);

export function validateFaceReport(x: unknown): { ok: true; report: FaceReport } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (typeof x !== "object" || x === null) return { ok: false, errors: ["not an object"] };
  const r = x as Record<string, unknown>;
  if (r.kind !== "face-v2") errors.push("kind must be face-v2");
  const overall = r.overall as Record<string, unknown> | undefined;
  if (!in01(overall?.score) || !in01(overall?.confidence)) errors.push("overall malformed");
  const dims = r.dimensions as Record<string, unknown> | undefined;
  if (!dims) errors.push("dimensions missing");
  else {
    for (const key of FACE_DIMENSIONS) {
      const d = dims[key] as Record<string, unknown> | undefined;
      if (!d || !in01(d.score) || !in01(d.confidence) || !Array.isArray(d.perZone) || typeof d.evidence !== "string")
        errors.push(`dimension ${key} missing or malformed`);
    }
  }
  const cap = r.capture as Record<string, unknown> | undefined;
  if (!Array.isArray(cap?.angles)) errors.push("capture.angles missing");
  const rec = r.recommendations as Record<string, unknown> | undefined;
  if (!Array.isArray(rec?.skincare) || !Array.isArray(rec?.treatments)) errors.push("recommendations malformed");
  if (typeof r.disclaimer !== "string" || r.disclaimer.length === 0) errors.push("disclaimer missing");
  if (typeof r.pipelineVersion !== "number") errors.push("pipelineVersion missing");
  if (typeof r.modelVersions !== "object" || r.modelVersions === null) errors.push("modelVersions missing");
  return errors.length === 0 ? { ok: true, report: x as FaceReport } : { ok: false, errors };
}
```

- [ ] **Step 4 — run, see PASS.** Full gates: `npm run typecheck && npx vitest run shared/`.
- [ ] **Step 5 — commit:** `git add shared/face.ts shared/face.test.ts && git commit -m "feat(face): wire contract (angles, dimensions, zones, report validator)"`

---

### Task 2: Pipeline data types + synthetic fixture factory

**Files:** Create `ai/face/types.ts`, `ai/face/testing/fixtures.ts` · Test `ai/face/testing/fixtures.test.ts`

- [ ] **Step 1 — failing test:**

```typescript
// ai/face/testing/fixtures.test.ts
import { describe, it, expect } from "vitest";
import { makePixels, paintRect, syntheticGeometry } from "./fixtures";

describe("fixtures", () => {
  it("makePixels fills RGBA", () => {
    const px = makePixels(10, 10, { r: 200, g: 150, b: 120 });
    expect(px.data.length).toBe(400);
    expect(px.data[0]).toBe(200);
    expect(px.data[3]).toBe(255);
  });
  it("paintRect overwrites a region", () => {
    const px = makePixels(10, 10, { r: 0, g: 0, b: 0 });
    paintRect(px, { x: 2, y: 2, w: 3, h: 3 }, { r: 255, g: 0, b: 0 });
    const idx = (3 * 10 + 3) * 4;
    expect(px.data[idx]).toBe(255);
  });
  it("syntheticGeometry yields 478 landmarks with a frontal pose", () => {
    const g = syntheticGeometry("front");
    expect(g.landmarks).toHaveLength(478);
    expect(Math.abs(g.yawDeg)).toBeLessThan(5);
    expect(syntheticGeometry("left-45").yawDeg).toBeLessThan(-30);
  });
});
```

- [ ] **Step 2 — run, see FAIL.**
- [ ] **Step 3 — implement:**

```typescript
// ai/face/types.ts
import type { FaceAngle, FaceAnalysisZone, AngleQuality } from "../../shared/face";

export interface Pixels { data: Uint8ClampedArray; width: number; height: number } // RGBA rows
export interface Landmark { x: number; y: number; z: number }  // normalized 0..1 image coords
export interface FaceGeometry {
  landmarks: Landmark[];   // 478 MediaPipe face-landmarker points
  yawDeg: number;          // + = facing right
  pitchDeg: number;
  rollDeg: number;
}
export interface CapturedView {
  angle: FaceAngle;
  pixels: Pixels;
  geometry: FaceGeometry | null;  // null = no face detected
}
export interface ZoneStats {
  zone: FaceAnalysisZone;
  pixelCount: number;
  meanR: number; meanG: number; meanB: number;
  meanLuma: number;      // 0..1
  lumaStd: number;       // 0..1
  rednessIdx: number;    // mean of (r - (g+b)/2)/255, clamped ≥ 0
  highFreqRatio: number; // |luma - 4-neighbour mean| average, 0..1
  darkSpotRatio: number; // share of pixels with luma < meanLuma - 2*lumaStd
  brightSpotRatio: number; // share with luma > meanLuma + 2*lumaStd (specular)
  redSpotRatio: number;  // share with per-pixel redness > rednessIdx + 0.08
}
export interface AnalyzedView {
  angle: FaceAngle;
  quality: AngleQuality;
  zones: Partial<Record<FaceAnalysisZone, ZoneStats>>; // only zones visible from this angle
}
```

```typescript
// ai/face/testing/fixtures.ts
// Synthetic pixels + geometry so the whole core is testable without MediaPipe or a camera.
import type { FaceAngle } from "../../../shared/face";
import type { FaceGeometry, Pixels } from "../types";

export function makePixels(width: number, height: number, c: { r: number; g: number; b: number }): Pixels {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = c.r; data[i + 1] = c.g; data[i + 2] = c.b; data[i + 3] = 255;
  }
  return { data, width, height };
}

export function paintRect(px: Pixels, rect: { x: number; y: number; w: number; h: number }, c: { r: number; g: number; b: number }): void {
  for (let y = rect.y; y < rect.y + rect.h; y++) {
    for (let x = rect.x; x < rect.x + rect.w; x++) {
      const i = (y * px.width + x) * 4;
      px.data[i] = c.r; px.data[i + 1] = c.g; px.data[i + 2] = c.b;
    }
  }
}

export function addNoise(px: Pixels, amplitude: number, seed = 42): void {
  let s = seed;
  const rand = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let i = 0; i < px.data.length; i += 4) {
    const n = Math.round((rand() - 0.5) * 2 * amplitude);
    px.data[i] = Math.max(0, Math.min(255, px.data[i] + n));
    px.data[i + 1] = Math.max(0, Math.min(255, px.data[i + 1] + n));
    px.data[i + 2] = Math.max(0, Math.min(255, px.data[i + 2] + n));
  }
}

const ANGLE_YAW: Record<FaceAngle, number> = {
  front: 0, "left-45": -45, "right-45": 45, "left-profile": -80, "right-profile": 80,
};

/** 478 landmarks laid out as an ellipse-ish grid centered in the image; enough geometry
 * for zone polygons and pose tests. NOT anatomically exact — tests assert structure, not beauty. */
export function syntheticGeometry(angle: FaceAngle, cx = 0.5, cy = 0.5, scale = 0.35): FaceGeometry {
  const landmarks = Array.from({ length: 478 }, (_, i) => {
    const t = (i / 478) * Math.PI * 2;
    const ring = 0.3 + 0.7 * ((i % 10) / 10);
    return { x: cx + Math.cos(t) * scale * ring, y: cy + Math.sin(t) * scale * ring * 1.3, z: 0 };
  });
  return { landmarks, yawDeg: ANGLE_YAW[angle], pitchDeg: 0, rollDeg: 0 };
}
```

- [ ] **Step 4 — run, see PASS.** **Step 5 — commit:** `git commit -am "feat(face): pipeline types + synthetic fixtures (no-mediapipe testing)"`

---

### Task 3: Zone polygons from landmarks + rasterized masks

**Files:** Create `ai/face/landmarks/zones.ts` · Test `ai/face/landmarks/zones.test.ts`

- [ ] **Step 1 — failing test:**

```typescript
// ai/face/landmarks/zones.test.ts
import { describe, it, expect } from "vitest";
import { zonesVisibleFrom, zonePolygon, maskForZone } from "./zones";
import { syntheticGeometry, makePixels } from "../testing/fixtures";

describe("zones", () => {
  it("front view sees all zones; profiles see one side", () => {
    expect(zonesVisibleFrom("front")).toContain("left-cheek");
    expect(zonesVisibleFrom("front")).toContain("right-cheek");
    expect(zonesVisibleFrom("left-profile")).toContain("left-cheek");
    expect(zonesVisibleFrom("left-profile")).not.toContain("right-cheek");
  });
  it("zonePolygon returns ≥3 points within image bounds", () => {
    const g = syntheticGeometry("front");
    for (const zone of zonesVisibleFrom("front")) {
      const poly = zonePolygon(zone, g);
      expect(poly.length).toBeGreaterThanOrEqual(3);
      for (const p of poly) {
        expect(p.x).toBeGreaterThanOrEqual(0); expect(p.x).toBeLessThanOrEqual(1);
        expect(p.y).toBeGreaterThanOrEqual(0); expect(p.y).toBeLessThanOrEqual(1);
      }
    }
  });
  it("maskForZone marks interior pixels", () => {
    const g = syntheticGeometry("front");
    const px = makePixels(100, 100, { r: 0, g: 0, b: 0 });
    const mask = maskForZone("forehead", g, px.width, px.height);
    const inside = mask.reduce((n, b) => n + b, 0);
    expect(inside).toBeGreaterThan(20);          // nontrivial region
    expect(inside).toBeLessThan(100 * 100 * 0.6); // not the whole image
  });
});
```

- [ ] **Step 2 — run, see FAIL.**
- [ ] **Step 3 — implement:**

```typescript
// ai/face/landmarks/zones.ts
// Zone polygons from MediaPipe face-landmarker indices. Index sets are v1-coarse and
// TUNABLE — tests assert structure (≥3 points, in-bounds, nontrivial masks), not anatomy.
import type { FaceAngle, FaceAnalysisZone } from "../../../shared/face";
import type { FaceGeometry } from "../types";

// Canonical MediaPipe FaceMesh indices (coarse convex outlines per zone).
const ZONE_INDICES: Record<FaceAnalysisZone, number[]> = {
  forehead: [10, 338, 297, 332, 284, 251, 21, 54, 103, 67, 109],
  nose: [6, 197, 195, 5, 4, 1, 19, 94, 2, 98, 327],
  "left-cheek": [116, 123, 147, 213, 192, 214, 212, 202, 210, 169, 150],
  "right-cheek": [345, 352, 376, 433, 416, 434, 432, 422, 430, 394, 379],
  chin: [148, 152, 377, 400, 378, 379, 365, 397, 288, 361, 323],
  periorbital: [70, 63, 105, 66, 107, 336, 296, 334, 293, 300],
  "under-eye": [111, 117, 118, 119, 120, 121, 350, 349, 348, 347, 346, 340],
};

const VISIBILITY: Record<FaceAngle, FaceAnalysisZone[]> = {
  front: ["forehead", "nose", "left-cheek", "right-cheek", "chin", "periorbital", "under-eye"],
  "left-45": ["forehead", "nose", "left-cheek", "chin", "periorbital", "under-eye"],
  "right-45": ["forehead", "nose", "right-cheek", "chin", "periorbital", "under-eye"],
  "left-profile": ["left-cheek", "chin"],
  "right-profile": ["right-cheek", "chin"],
};

export function zonesVisibleFrom(angle: FaceAngle): FaceAnalysisZone[] {
  return VISIBILITY[angle];
}

export function zonePolygon(zone: FaceAnalysisZone, g: FaceGeometry): { x: number; y: number }[] {
  const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
  return ZONE_INDICES[zone].map((i) => ({ x: clamp01(g.landmarks[i].x), y: clamp01(g.landmarks[i].y) }));
}

/** Rasterize a zone polygon → Uint8Array mask (1 = inside), even-odd point-in-polygon. */
export function maskForZone(zone: FaceAnalysisZone, g: FaceGeometry, width: number, height: number): Uint8Array {
  const poly = zonePolygon(zone, g).map((p) => ({ x: p.x * width, y: p.y * height }));
  const mask = new Uint8Array(width * height);
  const xs = poly.map((p) => p.x), ys = poly.map((p) => p.y);
  const minX = Math.max(0, Math.floor(Math.min(...xs))), maxX = Math.min(width - 1, Math.ceil(Math.max(...xs)));
  const minY = Math.max(0, Math.floor(Math.min(...ys))), maxY = Math.min(height - 1, Math.ceil(Math.max(...ys)));
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      let inside = false;
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const yi = poly[i].y, yj = poly[j].y, xi = poly[i].x, xj = poly[j].x;
        if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
      }
      if (inside) mask[y * width + x] = 1;
    }
  }
  return mask;
}
```

- [ ] **Step 4 — run, see PASS.** **Step 5 — commit:** `git commit -am "feat(face): zone polygons + rasterized masks from landmarks"`

---

### Task 4: Per-zone pixel statistics (the one expensive pass)

**Files:** Create `ai/face/stats.ts` · Test `ai/face/stats.test.ts`

- [ ] **Step 1 — failing test:**

```typescript
// ai/face/stats.test.ts
import { describe, it, expect } from "vitest";
import { zoneStats } from "./stats";
import { makePixels, paintRect, addNoise } from "./testing/fixtures";

const fullMask = (w: number, h: number) => new Uint8Array(w * h).fill(1);

describe("zoneStats", () => {
  it("computes means on a flat image", () => {
    const px = makePixels(20, 20, { r: 200, g: 150, b: 120 });
    const s = zoneStats("forehead", px, fullMask(20, 20));
    expect(s.meanR).toBeCloseTo(200, 0);
    expect(s.lumaStd).toBeCloseTo(0, 2);
    expect(s.highFreqRatio).toBeCloseTo(0, 2);
  });
  it("redness index rises with red-dominant pixels", () => {
    const skin = makePixels(20, 20, { r: 190, g: 140, b: 120 });
    const red = makePixels(20, 20, { r: 230, g: 110, b: 100 });
    const sSkin = zoneStats("left-cheek", skin, fullMask(20, 20));
    const sRed = zoneStats("left-cheek", red, fullMask(20, 20));
    expect(sRed.rednessIdx).toBeGreaterThan(sSkin.rednessIdx);
  });
  it("dark spots raise darkSpotRatio", () => {
    const px = makePixels(40, 40, { r: 190, g: 150, b: 130 });
    addNoise(px, 4);
    paintRect(px, { x: 5, y: 5, w: 4, h: 4 }, { r: 60, g: 45, b: 40 });
    paintRect(px, { x: 20, y: 20, w: 4, h: 4 }, { r: 60, g: 45, b: 40 });
    const s = zoneStats("right-cheek", px, fullMask(40, 40));
    expect(s.darkSpotRatio).toBeGreaterThan(0.01);
  });
  it("noise raises highFreqRatio", () => {
    const flat = makePixels(30, 30, { r: 180, g: 140, b: 120 });
    const noisy = makePixels(30, 30, { r: 180, g: 140, b: 120 });
    addNoise(noisy, 40);
    expect(zoneStats("nose", noisy, fullMask(30, 30)).highFreqRatio)
      .toBeGreaterThan(zoneStats("nose", flat, fullMask(30, 30)).highFreqRatio);
  });
  it("empty mask yields pixelCount 0 without NaN", () => {
    const px = makePixels(10, 10, { r: 100, g: 100, b: 100 });
    const s = zoneStats("chin", px, new Uint8Array(100));
    expect(s.pixelCount).toBe(0);
    expect(Number.isNaN(s.meanLuma)).toBe(false);
  });
});
```

- [ ] **Step 2 — run, see FAIL.**
- [ ] **Step 3 — implement:**

```typescript
// ai/face/stats.ts
// Single pixel pass per zone → ZoneStats. Analyzers never touch pixels directly.
import type { FaceAnalysisZone } from "../../shared/face";
import type { Pixels, ZoneStats } from "./types";

export function zoneStats(zone: FaceAnalysisZone, px: Pixels, mask: Uint8Array): ZoneStats {
  const { data, width, height } = px;
  let n = 0, sumR = 0, sumG = 0, sumB = 0, sumLuma = 0, sumLuma2 = 0, sumRedIdx = 0;
  const lumas = new Float32Array(width * height);
  const redIdxs = new Float32Array(width * height);

  for (let p = 0; p < width * height; p++) {
    if (!mask[p]) continue;
    const i = p * 4;
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const luma = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    const redIdx = Math.max(0, (r - (g + b) / 2) / 255);
    lumas[p] = luma; redIdxs[p] = redIdx;
    n++; sumR += r; sumG += g; sumB += b;
    sumLuma += luma; sumLuma2 += luma * luma; sumRedIdx += redIdx;
  }
  if (n === 0) {
    return { zone, pixelCount: 0, meanR: 0, meanG: 0, meanB: 0, meanLuma: 0, lumaStd: 0,
      rednessIdx: 0, highFreqRatio: 0, darkSpotRatio: 0, brightSpotRatio: 0, redSpotRatio: 0 };
  }
  const meanLuma = sumLuma / n;
  const lumaStd = Math.sqrt(Math.max(0, sumLuma2 / n - meanLuma * meanLuma));
  const rednessIdx = sumRedIdx / n;

  let hf = 0, dark = 0, bright = 0, redSpot = 0;
  const darkT = meanLuma - 2 * lumaStd, brightT = meanLuma + 2 * lumaStd, redT = rednessIdx + 0.08;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = y * width + x;
      if (!mask[p]) continue;
      let nbSum = 0, nb = 0;
      if (x > 0 && mask[p - 1]) { nbSum += lumas[p - 1]; nb++; }
      if (x < width - 1 && mask[p + 1]) { nbSum += lumas[p + 1]; nb++; }
      if (y > 0 && mask[p - width]) { nbSum += lumas[p - width]; nb++; }
      if (y < height - 1 && mask[p + width]) { nbSum += lumas[p + width]; nb++; }
      if (nb > 0) hf += Math.abs(lumas[p] - nbSum / nb);
      if (lumas[p] < darkT) dark++;
      if (lumas[p] > brightT) bright++;
      if (redIdxs[p] > redT) redSpot++;
    }
  }
  return {
    zone, pixelCount: n,
    meanR: sumR / n, meanG: sumG / n, meanB: sumB / n,
    meanLuma, lumaStd, rednessIdx,
    highFreqRatio: hf / n,
    darkSpotRatio: dark / n,
    brightSpotRatio: bright / n,
    redSpotRatio: redSpot / n,
  };
}
```

- [ ] **Step 4 — run, see PASS.** **Step 5 — commit:** `git commit -am "feat(face): per-zone pixel statistics pass"`

---

### Task 5: Per-image quality validation

**Files:** Create `ai/face/quality/validate.ts` · Test `ai/face/quality/validate.test.ts`

- [ ] **Step 1 — failing test:**

```typescript
// ai/face/quality/validate.test.ts
import { describe, it, expect } from "vitest";
import { validateCapture, ANGLE_YAW_WINDOWS } from "./validate";
import { makePixels, addNoise, syntheticGeometry } from "../testing/fixtures";

const goodPixels = () => { const p = makePixels(640, 640, { r: 185, g: 145, b: 125 }); addNoise(p, 25); return p; };

describe("validateCapture", () => {
  it("passes a good frontal capture", () => {
    const q = validateCapture("front", goodPixels(), syntheticGeometry("front"));
    expect(q.ok).toBe(true);
    expect(q.issues).toEqual([]);
  });
  it("no face detected", () => {
    const q = validateCapture("front", goodPixels(), null);
    expect(q.ok).toBe(false);
    expect(q.issues).toContain("no-face");
  });
  it("wrong orientation for the requested angle", () => {
    const q = validateCapture("left-45", goodPixels(), syntheticGeometry("front"));
    expect(q.issues).toContain("wrong-orientation");
  });
  it("too dark", () => {
    const dark = makePixels(640, 640, { r: 20, g: 15, b: 12 });
    const q = validateCapture("front", dark, syntheticGeometry("front"));
    expect(q.issues).toContain("too-dark");
  });
  it("blur (no high-frequency detail)", () => {
    const flat = makePixels(640, 640, { r: 185, g: 145, b: 125 }); // zero texture = blur proxy
    const q = validateCapture("front", flat, syntheticGeometry("front"));
    expect(q.issues).toContain("blur");
  });
  it("face too small in frame", () => {
    const q = validateCapture("front", goodPixels(), syntheticGeometry("front", 0.5, 0.5, 0.08));
    expect(q.issues).toContain("face-too-small");
  });
  it("low resolution", () => {
    const tiny = makePixels(200, 200, { r: 185, g: 145, b: 125 });
    addNoise(tiny, 25);
    const q = validateCapture("front", tiny, syntheticGeometry("front"));
    expect(q.issues).toContain("low-resolution");
  });
  it("yaw windows cover all five angles", () => {
    expect(Object.keys(ANGLE_YAW_WINDOWS)).toHaveLength(5);
  });
});
```

- [ ] **Step 2 — run, see FAIL.**
- [ ] **Step 3 — implement:**

```typescript
// ai/face/quality/validate.ts
// Per-image gate. Every threshold is a named, tunable constant.
import type { FaceAngle, AngleQuality } from "../../../shared/face";
import type { FaceGeometry, Pixels } from "../types";

export const MIN_EDGE_PX = 480;
export const LUMA_MIN = 0.15;
export const LUMA_MAX = 0.9;
export const BLUR_MIN_HF = 0.004;       // mean |luma - neighbour mean| over the whole frame
export const FACE_MIN_FRACTION = 0.18;  // face bbox height / image height
export const ANGLE_YAW_WINDOWS: Record<FaceAngle, [number, number]> = {
  front: [-12, 12], "left-45": [-60, -30], "right-45": [30, 60],
  "left-profile": [-95, -65], "right-profile": [65, 95],
};

function frameLumaStats(px: Pixels): { mean: number; hf: number } {
  const { data, width, height } = px;
  const lumas = new Float32Array(width * height);
  let sum = 0;
  for (let p = 0; p < width * height; p++) {
    const i = p * 4;
    lumas[p] = (0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]) / 255;
    sum += lumas[p];
  }
  let hf = 0, cnt = 0;
  for (let y = 1; y < height - 1; y += 2) {       // stride 2: cheap
    for (let x = 1; x < width - 1; x += 2) {
      const p = y * width + x;
      const nbMean = (lumas[p - 1] + lumas[p + 1] + lumas[p - width] + lumas[p + width]) / 4;
      hf += Math.abs(lumas[p] - nbMean); cnt++;
    }
  }
  return { mean: sum / (width * height), hf: cnt ? hf / cnt : 0 };
}

function faceFraction(g: FaceGeometry): number {
  let minY = 1, maxY = 0;
  for (const l of g.landmarks) { if (l.y < minY) minY = l.y; if (l.y > maxY) maxY = l.y; }
  return maxY - minY;
}

export function validateCapture(angle: FaceAngle, px: Pixels, geometry: FaceGeometry | null): AngleQuality {
  const issues: string[] = [];
  if (Math.min(px.width, px.height) < MIN_EDGE_PX) issues.push("low-resolution");
  const { mean, hf } = frameLumaStats(px);
  if (mean < LUMA_MIN) issues.push("too-dark");
  if (mean > LUMA_MAX) issues.push("too-bright");
  if (hf < BLUR_MIN_HF) issues.push("blur");
  if (!geometry) {
    issues.push("no-face");
    return { ok: false, issues };
  }
  const [lo, hi] = ANGLE_YAW_WINDOWS[angle];
  if (geometry.yawDeg < lo || geometry.yawDeg > hi) issues.push("wrong-orientation");
  if (faceFraction(geometry) < FACE_MIN_FRACTION) issues.push("face-too-small");
  return { ok: issues.length === 0, issues };
}
```

- [ ] **Step 4 — run, see PASS.** **Step 5 — commit:** `git commit -am "feat(face): per-image capture quality validation"`

---

### Task 6: Analyzer interface + first four analyzers (redness, oiliness, pigmentation, tone-consistency)

**Files:** Create `ai/face/analyzers/types.ts`, `ai/face/analyzers/color.ts` · Test `ai/face/analyzers/color.test.ts`

- [ ] **Step 1 — failing test:**

```typescript
// ai/face/analyzers/color.test.ts
import { describe, it, expect } from "vitest";
import { rednessAnalyzer, oilinessAnalyzer, pigmentationAnalyzer, toneConsistencyAnalyzer } from "./color";
import type { AnalyzedView, ZoneStats } from "../types";

function stats(zone: ZoneStats["zone"], over: Partial<ZoneStats> = {}): ZoneStats {
  return { zone, pixelCount: 1000, meanR: 185, meanG: 145, meanB: 125, meanLuma: 0.6, lumaStd: 0.05,
    rednessIdx: 0.12, highFreqRatio: 0.01, darkSpotRatio: 0.01, brightSpotRatio: 0.01, redSpotRatio: 0.01, ...over };
}
function view(zones: ZoneStats[]): AnalyzedView {
  return { angle: "front", quality: { ok: true, issues: [] },
    zones: Object.fromEntries(zones.map((z) => [z.zone, z])) };
}

describe("color analyzers", () => {
  it("redness scores higher for redder cheeks", () => {
    const calm = rednessAnalyzer([view([stats("left-cheek"), stats("right-cheek")])]);
    const red = rednessAnalyzer([view([stats("left-cheek", { rednessIdx: 0.3, redSpotRatio: 0.2 }), stats("right-cheek", { rednessIdx: 0.3, redSpotRatio: 0.2 })])]);
    expect(red.score).toBeGreaterThan(calm.score);
    expect(red.perZone.length).toBe(2);
    expect(red.evidence).toMatch(/erythema|redness/i);
  });
  it("oiliness keys on T-zone specular highlights", () => {
    const matte = oilinessAnalyzer([view([stats("forehead"), stats("nose")])]);
    const shiny = oilinessAnalyzer([view([stats("forehead", { brightSpotRatio: 0.15 }), stats("nose", { brightSpotRatio: 0.2 })])]);
    expect(shiny.score).toBeGreaterThan(matte.score);
  });
  it("pigmentation keys on dark-spot density", () => {
    const clear = pigmentationAnalyzer([view([stats("left-cheek"), stats("forehead")])]);
    const spotted = pigmentationAnalyzer([view([stats("left-cheek", { darkSpotRatio: 0.12 }), stats("forehead", { darkSpotRatio: 0.1 })])]);
    expect(spotted.score).toBeGreaterThan(clear.score);
  });
  it("tone consistency penalizes luma spread ACROSS zones", () => {
    const even = toneConsistencyAnalyzer([view([stats("forehead", { meanLuma: 0.6 }), stats("chin", { meanLuma: 0.6 })])]);
    const uneven = toneConsistencyAnalyzer([view([stats("forehead", { meanLuma: 0.75 }), stats("chin", { meanLuma: 0.45 })])]);
    expect(uneven.score).toBeGreaterThan(even.score);
  });
  it("no visible zones → zero confidence, not NaN", () => {
    const r = rednessAnalyzer([view([])]);
    expect(r.confidence).toBe(0);
    expect(Number.isNaN(r.score)).toBe(false);
  });
});
```

- [ ] **Step 2 — run, see FAIL.**
- [ ] **Step 3 — implement:**

```typescript
// ai/face/analyzers/types.ts
import type { DimensionScore, FaceAnalysisZone } from "../../../shared/face";
import type { AnalyzedView, ZoneStats } from "../types";

export type Analyzer = (views: AnalyzedView[]) => DimensionScore;

export const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

/** Collect this zone's stats across all views that saw it (quality-weighted later by merge;
 * within a dimension we average views seeing the same zone). */
export function collectZones(views: AnalyzedView[], zones: FaceAnalysisZone[]): Map<FaceAnalysisZone, ZoneStats[]> {
  const out = new Map<FaceAnalysisZone, ZoneStats[]>();
  for (const v of views) {
    for (const z of zones) {
      const s = v.zones[z];
      if (s && s.pixelCount > 0) out.set(z, [...(out.get(z) ?? []), s]);
    }
  }
  return out;
}

/** Standard scaffold: score each zone via `zoneScore`, average views per zone, average zones. */
export function zoneMeanDimension(
  views: AnalyzedView[],
  zones: FaceAnalysisZone[],
  zoneScore: (s: ZoneStats) => number,
  evidence: string,
): DimensionScore {
  const collected = collectZones(views, zones);
  if (collected.size === 0) return { score: 0, confidence: 0, perZone: [], evidence: `${evidence} (no zones visible)` };
  const perZone = [...collected.entries()].map(([zone, list]) => ({
    zone, score: clamp01(list.reduce((a, s) => a + zoneScore(s), 0) / list.length),
  }));
  const score = clamp01(perZone.reduce((a, z) => a + z.score, 0) / perZone.length);
  const confidence = clamp01(collected.size / zones.length);   // zone coverage; merge refines further
  return { score, confidence, perZone, evidence };
}
```

```typescript
// ai/face/analyzers/color.ts
// Color-family analyzers. Scores are normalized against named baselines — tunable constants.
import { zoneMeanDimension, clamp01, collectZones, type Analyzer } from "./types";

const REDNESS_BASELINE = 0.10;   // typical skin rednessIdx
const REDNESS_SPAN = 0.25;
export const rednessAnalyzer: Analyzer = (views) =>
  zoneMeanDimension(views, ["left-cheek", "right-cheek", "nose", "chin"],
    (s) => clamp01((s.rednessIdx - REDNESS_BASELINE) / REDNESS_SPAN + s.redSpotRatio * 2),
    "mean erythema index + red-spot density across cheeks/nose/chin");

const OIL_SPAN = 0.25;
export const oilinessAnalyzer: Analyzer = (views) =>
  zoneMeanDimension(views, ["forehead", "nose", "chin"],
    (s) => clamp01(s.brightSpotRatio / OIL_SPAN),
    "specular highlight ratio across the T-zone");

const PIGMENT_SPAN = 0.15;
export const pigmentationAnalyzer: Analyzer = (views) =>
  zoneMeanDimension(views, ["left-cheek", "right-cheek", "forehead"],
    (s) => clamp01(s.darkSpotRatio / PIGMENT_SPAN),
    "dark-spot density across cheeks/forehead");

const TONE_SPAN = 0.25;
export const toneConsistencyAnalyzer: Analyzer = (views) => {
  const collected = collectZones(views, ["forehead", "nose", "left-cheek", "right-cheek", "chin"]);
  if (collected.size < 2) return { score: 0, confidence: 0, perZone: [], evidence: "cross-zone luma spread (insufficient zones)" };
  const zoneLumas = [...collected.entries()].map(([zone, list]) => ({
    zone, luma: list.reduce((a, s) => a + s.meanLuma, 0) / list.length,
  }));
  const mean = zoneLumas.reduce((a, z) => a + z.luma, 0) / zoneLumas.length;
  const spread = Math.sqrt(zoneLumas.reduce((a, z) => a + (z.luma - mean) ** 2, 0) / zoneLumas.length);
  const score = clamp01(spread / TONE_SPAN);
  return {
    score,
    confidence: clamp01(collected.size / 5),
    perZone: zoneLumas.map((z) => ({ zone: z.zone, score: clamp01(Math.abs(z.luma - mean) / TONE_SPAN) })),
    evidence: "cross-zone luma spread (uneven tone)",
  };
};
```

- [ ] **Step 4 — run, see PASS.** **Step 5 — commit:** `git commit -am "feat(face): analyzer interface + color analyzers (redness/oiliness/pigmentation/tone)"`

---

### Task 7: Texture-family analyzers (texture, pores, fine-lines, wrinkles, dryness)

**Files:** Create `ai/face/analyzers/texture.ts` · Test `ai/face/analyzers/texture.test.ts`

- [ ] **Step 1 — failing test:**

```typescript
// ai/face/analyzers/texture.test.ts
import { describe, it, expect } from "vitest";
import { textureAnalyzer, poresAnalyzer, fineLinesAnalyzer, wrinklesAnalyzer, drynessAnalyzer } from "./texture";
import type { AnalyzedView, ZoneStats } from "../types";

function stats(zone: ZoneStats["zone"], over: Partial<ZoneStats> = {}): ZoneStats {
  return { zone, pixelCount: 1000, meanR: 185, meanG: 145, meanB: 125, meanLuma: 0.6, lumaStd: 0.05,
    rednessIdx: 0.12, highFreqRatio: 0.008, darkSpotRatio: 0.01, brightSpotRatio: 0.01, redSpotRatio: 0.01, ...over };
}
const view = (zones: ZoneStats[]): AnalyzedView =>
  ({ angle: "front", quality: { ok: true, issues: [] }, zones: Object.fromEntries(zones.map((z) => [z.zone, z])) });

describe("texture analyzers", () => {
  it("texture rises with high-frequency energy on cheeks", () => {
    const smooth = textureAnalyzer([view([stats("left-cheek"), stats("right-cheek")])]);
    const rough = textureAnalyzer([view([stats("left-cheek", { highFreqRatio: 0.05 }), stats("right-cheek", { highFreqRatio: 0.05 })])]);
    expect(rough.score).toBeGreaterThan(smooth.score);
  });
  it("pores key on nose+cheek micro-contrast", () => {
    const fine = poresAnalyzer([view([stats("nose"), stats("left-cheek")])]);
    const coarse = poresAnalyzer([view([stats("nose", { highFreqRatio: 0.06, darkSpotRatio: 0.05 }), stats("left-cheek", { highFreqRatio: 0.05, darkSpotRatio: 0.04 })])]);
    expect(coarse.score).toBeGreaterThan(fine.score);
  });
  it("fine lines read periorbital+under-eye micro-texture", () => {
    const young = fineLinesAnalyzer([view([stats("periorbital"), stats("under-eye")])]);
    const lined = fineLinesAnalyzer([view([stats("periorbital", { highFreqRatio: 0.04 }), stats("under-eye", { highFreqRatio: 0.04 })])]);
    expect(lined.score).toBeGreaterThan(young.score);
  });
  it("wrinkles read forehead+periorbital with luma-contrast weighting", () => {
    const smooth = wrinklesAnalyzer([view([stats("forehead"), stats("periorbital")])]);
    const deep = wrinklesAnalyzer([view([stats("forehead", { highFreqRatio: 0.05, lumaStd: 0.15 }), stats("periorbital", { highFreqRatio: 0.05, lumaStd: 0.15 })])]);
    expect(deep.score).toBeGreaterThan(smooth.score);
  });
  it("dryness = flaky micro-texture WITHOUT shine", () => {
    const normal = drynessAnalyzer([view([stats("left-cheek"), stats("chin")])]);
    const dry = drynessAnalyzer([view([stats("left-cheek", { highFreqRatio: 0.04, brightSpotRatio: 0.002 }), stats("chin", { highFreqRatio: 0.04, brightSpotRatio: 0.002 })])]);
    const oily = drynessAnalyzer([view([stats("left-cheek", { highFreqRatio: 0.04, brightSpotRatio: 0.2 }), stats("chin", { highFreqRatio: 0.04, brightSpotRatio: 0.2 })])]);
    expect(dry.score).toBeGreaterThan(normal.score);
    expect(dry.score).toBeGreaterThan(oily.score);
  });
});
```

- [ ] **Step 2 — run, see FAIL.**
- [ ] **Step 3 — implement:**

```typescript
// ai/face/analyzers/texture.ts
import { zoneMeanDimension, clamp01, type Analyzer } from "./types";

const HF_BASE = 0.008;   // smooth-skin high-frequency floor
const HF_SPAN = 0.05;

export const textureAnalyzer: Analyzer = (views) =>
  zoneMeanDimension(views, ["left-cheek", "right-cheek", "forehead", "chin"],
    (s) => clamp01((s.highFreqRatio - HF_BASE) / HF_SPAN),
    "surface high-frequency energy (relief) across cheeks/forehead/chin");

export const poresAnalyzer: Analyzer = (views) =>
  zoneMeanDimension(views, ["nose", "left-cheek", "right-cheek"],
    (s) => clamp01((s.highFreqRatio - HF_BASE) / HF_SPAN * 0.7 + s.darkSpotRatio * 4 * 0.3),
    "micro-contrast + dark-pit density on nose/cheeks");

export const fineLinesAnalyzer: Analyzer = (views) =>
  zoneMeanDimension(views, ["periorbital", "under-eye"],
    (s) => clamp01((s.highFreqRatio - HF_BASE) / HF_SPAN),
    "micro-texture in periorbital/under-eye zones");

export const wrinklesAnalyzer: Analyzer = (views) =>
  zoneMeanDimension(views, ["forehead", "periorbital"],
    (s) => clamp01(((s.highFreqRatio - HF_BASE) / HF_SPAN) * 0.6 + (s.lumaStd / 0.2) * 0.4),
    "deep-relief contrast (high-frequency + shadow spread) on forehead/periorbital");

export const drynessAnalyzer: Analyzer = (views) =>
  zoneMeanDimension(views, ["left-cheek", "right-cheek", "chin"],
    (s) => clamp01(((s.highFreqRatio - HF_BASE) / HF_SPAN) * (1 - clamp01(s.brightSpotRatio / 0.1))),
    "flaky micro-texture in the absence of specular shine (visual dryness proxy)");
```

- [ ] **Step 4 — run, see PASS.** **Step 5 — commit:** `git commit -am "feat(face): texture-family analyzers (texture/pores/fine-lines/wrinkles/dryness)"`

---

### Task 8: Remaining analyzers (acne, under-eye) + registry

**Files:** Create `ai/face/analyzers/spots.ts`, `ai/face/analyzers/index.ts` · Test `ai/face/analyzers/spots.test.ts`

- [ ] **Step 1 — failing test:**

```typescript
// ai/face/analyzers/spots.test.ts
import { describe, it, expect } from "vitest";
import { acneAnalyzer, underEyeAnalyzer } from "./spots";
import { ANALYZERS } from "./index";
import { FACE_DIMENSIONS } from "../../../shared/face";
import type { AnalyzedView, ZoneStats } from "../types";

function stats(zone: ZoneStats["zone"], over: Partial<ZoneStats> = {}): ZoneStats {
  return { zone, pixelCount: 1000, meanR: 185, meanG: 145, meanB: 125, meanLuma: 0.6, lumaStd: 0.05,
    rednessIdx: 0.12, highFreqRatio: 0.008, darkSpotRatio: 0.01, brightSpotRatio: 0.01, redSpotRatio: 0.01, ...over };
}
const view = (zones: ZoneStats[]): AnalyzedView =>
  ({ angle: "front", quality: { ok: true, issues: [] }, zones: Object.fromEntries(zones.map((z) => [z.zone, z])) });

describe("spot analyzers", () => {
  it("acne rises with red-spot clusters", () => {
    const clear = acneAnalyzer([view([stats("left-cheek"), stats("forehead"), stats("chin")])]);
    const breakout = acneAnalyzer([view([stats("left-cheek", { redSpotRatio: 0.1 }), stats("forehead", { redSpotRatio: 0.08 }), stats("chin", { redSpotRatio: 0.12 })])]);
    expect(breakout.score).toBeGreaterThan(clear.score);
  });
  it("under-eye keys on darkness relative to cheek luma", () => {
    const rested = underEyeAnalyzer([view([stats("under-eye", { meanLuma: 0.58 }), stats("left-cheek", { meanLuma: 0.6 })])]);
    const tired = underEyeAnalyzer([view([stats("under-eye", { meanLuma: 0.35 }), stats("left-cheek", { meanLuma: 0.6 })])]);
    expect(tired.score).toBeGreaterThan(rested.score);
  });
});

describe("registry", () => {
  it("covers every contract dimension exactly", () => {
    expect(Object.keys(ANALYZERS).sort()).toEqual([...FACE_DIMENSIONS].sort());
  });
});
```

- [ ] **Step 2 — run, see FAIL.**
- [ ] **Step 3 — implement:**

```typescript
// ai/face/analyzers/spots.ts
import { zoneMeanDimension, clamp01, collectZones, type Analyzer } from "./types";

export const acneAnalyzer: Analyzer = (views) =>
  zoneMeanDimension(views, ["left-cheek", "right-cheek", "forehead", "chin"],
    (s) => clamp01(s.redSpotRatio / 0.08),
    "inflamed (red-spot) cluster density across cheeks/forehead/chin");

export const underEyeAnalyzer: Analyzer = (views) => {
  const eyes = collectZones(views, ["under-eye"]);
  const cheeks = collectZones(views, ["left-cheek", "right-cheek"]);
  if (eyes.size === 0 || cheeks.size === 0)
    return { score: 0, confidence: 0, perZone: [], evidence: "under-eye vs cheek luma delta (zones not visible)" };
  const mean = (lists: typeof eyes) =>
    [...lists.values()].flat().reduce((a, s, _, arr) => a + s.meanLuma / arr.length, 0);
  const delta = mean(cheeks) - mean(eyes);         // darker under-eye → positive delta
  const score = clamp01(delta / 0.2);
  return {
    score, confidence: 1,
    perZone: [{ zone: "under-eye", score }],
    evidence: "under-eye darkness relative to cheek luma",
  };
};
```

```typescript
// ai/face/analyzers/index.ts
import type { FaceDimension } from "../../../shared/face";
import type { Analyzer } from "./types";
import { rednessAnalyzer, oilinessAnalyzer, pigmentationAnalyzer, toneConsistencyAnalyzer } from "./color";
import { textureAnalyzer, poresAnalyzer, fineLinesAnalyzer, wrinklesAnalyzer, drynessAnalyzer } from "./texture";
import { acneAnalyzer, underEyeAnalyzer } from "./spots";

// D1 seam: swap any single entry for a learned model without touching the others.
export const ANALYZERS: Record<FaceDimension, Analyzer> = {
  acne: acneAnalyzer,
  pigmentation: pigmentationAnalyzer,
  redness: rednessAnalyzer,
  texture: textureAnalyzer,
  pores: poresAnalyzer,
  oiliness: oilinessAnalyzer,
  dryness: drynessAnalyzer,
  "fine-lines": fineLinesAnalyzer,
  wrinkles: wrinklesAnalyzer,
  "under-eye": underEyeAnalyzer,
  "tone-consistency": toneConsistencyAnalyzer,
};
```

- [ ] **Step 4 — run, see PASS.** **Step 5 — commit:** `git commit -am "feat(face): acne + under-eye analyzers, full dimension registry"`

---

### Task 9: Merge + confidence + overall score

**Files:** Create `ai/face/merge/merge.ts` · Test `ai/face/merge/merge.test.ts`

- [ ] **Step 1 — failing test:**

```typescript
// ai/face/merge/merge.test.ts
import { describe, it, expect } from "vitest";
import { mergeViews, OVERALL_WEIGHTS } from "./merge";
import { FACE_DIMENSIONS } from "../../../shared/face";
import type { AnalyzedView, ZoneStats } from "../types";

function stats(zone: ZoneStats["zone"], over: Partial<ZoneStats> = {}): ZoneStats {
  return { zone, pixelCount: 1000, meanR: 185, meanG: 145, meanB: 125, meanLuma: 0.6, lumaStd: 0.05,
    rednessIdx: 0.12, highFreqRatio: 0.008, darkSpotRatio: 0.01, brightSpotRatio: 0.01, redSpotRatio: 0.01, ...over };
}
const view = (angle: AnalyzedView["angle"], zones: ZoneStats[], ok = true): AnalyzedView =>
  ({ angle, quality: { ok, issues: ok ? [] : ["blur"] }, zones: Object.fromEntries(zones.map((z) => [z.zone, z])) });

const fullFront = () => view("front", [stats("forehead"), stats("nose"), stats("left-cheek"), stats("right-cheek"), stats("chin"), stats("periorbital"), stats("under-eye")]);

describe("mergeViews", () => {
  it("produces every dimension with 0..1 scores", () => {
    const m = mergeViews([fullFront()]);
    for (const d of FACE_DIMENSIONS) {
      expect(m.dimensions[d].score).toBeGreaterThanOrEqual(0);
      expect(m.dimensions[d].score).toBeLessThanOrEqual(1);
    }
  });
  it("more angles raise confidence", () => {
    const one = mergeViews([fullFront()]);
    const three = mergeViews([fullFront(), view("left-45", [stats("left-cheek"), stats("forehead")]), view("right-45", [stats("right-cheek"), stats("forehead")])]);
    expect(three.dimensions.redness.confidence).toBeGreaterThanOrEqual(one.dimensions.redness.confidence);
    expect(three.overall.confidence).toBeGreaterThan(one.overall.confidence);
  });
  it("bad-quality views are excluded from analysis", () => {
    const clean = mergeViews([fullFront()]);
    const withBad = mergeViews([fullFront(), view("left-45", [stats("left-cheek", { rednessIdx: 0.9 })], false)]);
    expect(withBad.dimensions.redness.score).toBeCloseTo(clean.dimensions.redness.score, 5);
  });
  it("overall weights cover all dimensions and sum to 1", () => {
    expect(Object.keys(OVERALL_WEIGHTS).sort()).toEqual([...FACE_DIMENSIONS].sort());
    const sum = Object.values(OVERALL_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 5);
  });
  it("overall score improves (drops) when dimensions are calm", () => {
    const calm = mergeViews([fullFront()]);
    const angry = mergeViews([view("front", [stats("forehead", { brightSpotRatio: 0.3 }), stats("nose", { brightSpotRatio: 0.3 }), stats("left-cheek", { rednessIdx: 0.4, redSpotRatio: 0.2 }), stats("right-cheek", { rednessIdx: 0.4, redSpotRatio: 0.2 }), stats("chin"), stats("periorbital", { highFreqRatio: 0.06 }), stats("under-eye", { meanLuma: 0.3 })])]);
    expect(angry.overall.score).toBeGreaterThan(calm.overall.score);
  });
});
```

- [ ] **Step 2 — run, see FAIL.**
- [ ] **Step 3 — implement:**

```typescript
// ai/face/merge/merge.ts
// Cross-angle fusion. Views failing quality are excluded. Confidence blends analyzer
// coverage with capture coverage (required angles actually usable).
import { FACE_DIMENSIONS, type DimensionScore, type FaceDimension } from "../../../shared/face";
import { ANALYZERS } from "../analyzers/index";
import { clamp01 } from "../analyzers/types";
import type { AnalyzedView } from "../types";

export const REQUIRED_ANGLE_COUNT = 5;

// Versioned, visible weighting — never hidden. score semantics: higher = more pronounced issue.
export const OVERALL_WEIGHTS: Record<FaceDimension, number> = {
  acne: 0.14, pigmentation: 0.1, redness: 0.1, texture: 0.09, pores: 0.07,
  oiliness: 0.08, dryness: 0.08, "fine-lines": 0.09, wrinkles: 0.1,
  "under-eye": 0.07, "tone-consistency": 0.08,
};

export interface MergedAnalysis {
  dimensions: Record<FaceDimension, DimensionScore>;
  overall: { score: number; confidence: number };
}

export function mergeViews(views: AnalyzedView[]): MergedAnalysis {
  const usable = views.filter((v) => v.quality.ok);
  const captureCoverage = clamp01(usable.length / REQUIRED_ANGLE_COUNT);

  const dimensions = Object.fromEntries(
    FACE_DIMENSIONS.map((d) => {
      const raw = ANALYZERS[d](usable);
      return [d, { ...raw, confidence: clamp01(raw.confidence * (0.5 + 0.5 * captureCoverage)) }];
    }),
  ) as Record<FaceDimension, DimensionScore>;

  const overallScore = clamp01(
    FACE_DIMENSIONS.reduce((a, d) => a + dimensions[d].score * OVERALL_WEIGHTS[d], 0),
  );
  const overallConfidence = clamp01(
    FACE_DIMENSIONS.reduce((a, d) => a + dimensions[d].confidence, 0) / FACE_DIMENSIONS.length,
  );
  return { dimensions, overall: { score: overallScore, confidence: overallConfidence } };
}
```

- [ ] **Step 4 — run, see PASS.** **Step 5 — commit:** `git commit -am "feat(face): cross-angle merge with visible weights + confidence"`

---

### Task 10: Recommendations (deterministic rules) + disclaimer

**Files:** Create `ai/face/recommend/rules.ts` · Test `ai/face/recommend/rules.test.ts`

- [ ] **Step 1 — failing test:**

```typescript
// ai/face/recommend/rules.test.ts
import { describe, it, expect } from "vitest";
import { recommend, FACE_DISCLAIMER } from "./rules";
import { FACE_DIMENSIONS, type DimensionScore, type FaceDimension } from "../../../shared/face";

function dims(over: Partial<Record<FaceDimension, number>> = {}): Record<FaceDimension, DimensionScore> {
  return Object.fromEntries(FACE_DIMENSIONS.map((d) => [d, {
    score: over[d] ?? 0.1, confidence: 0.8, perZone: [], evidence: "test",
  }])) as Record<FaceDimension, DimensionScore>;
}

describe("recommend", () => {
  it("always includes sunscreen and the disclaimer exists", () => {
    const r = recommend(dims());
    expect(r.skincare.join(" ")).toMatch(/sunscreen/i);
    expect(FACE_DISCLAIMER).toMatch(/not a (medical )?diagnosis/i);
  });
  it("high acne adds acne guidance + professional treatment suggestion", () => {
    const r = recommend(dims({ acne: 0.7 }));
    expect(r.skincare.join(" ")).toMatch(/salicylic|cleanser|non-comedogenic/i);
    expect(r.treatments.join(" ")).toMatch(/dermatolog|professional/i);
  });
  it("high dryness adds moisturizer guidance", () => {
    expect(recommend(dims({ dryness: 0.7 })).skincare.join(" ")).toMatch(/moisturi|hydrat/i);
  });
  it("calm skin yields no treatment escalations", () => {
    expect(recommend(dims()).treatments).toEqual([]);
  });
  it("never emits prescription language", () => {
    const all = recommend(dims({ acne: 0.9, wrinkles: 0.9, pigmentation: 0.9 }));
    expect([...all.skincare, ...all.treatments].join(" ")).not.toMatch(/\b(tretinoin|isotretinoin|hydroquinone|dosage|mg)\b/i);
  });
});
```

- [ ] **Step 2 — run, see FAIL.**
- [ ] **Step 3 — implement:**

```typescript
// ai/face/recommend/rules.ts
// Deterministic recommendation rules, keyed by dimension score thresholds. Cosmetic-level
// guidance only — no prescriptions, no medication names, no clinical claims. Gemini may
// rephrase these (Phase C) but never extend them.
import type { DimensionScore, FaceDimension } from "../../../shared/face";

export const FACE_DISCLAIMER =
  "This is an automated cosmetic skin assessment, not a medical diagnosis. " +
  "For any concern about a specific spot, mole, or persistent condition, consult a qualified professional.";

const HIGH = 0.5;

interface Rule { dim: FaceDimension; skincare: string; treatment?: string }

const RULES: Rule[] = [
  { dim: "acne", skincare: "Use a gentle non-comedogenic cleanser; consider over-the-counter salicylic-acid products.", treatment: "Persistent or inflamed breakouts are worth a dermatologist visit." },
  { dim: "pigmentation", skincare: "Daily broad-spectrum sunscreen is the single best step against dark spots.", treatment: "A professional can advise on brightening treatments if spots bother you." },
  { dim: "redness", skincare: "Prefer fragrance-free products and avoid hot water on the face.", treatment: "Persistent facial redness can be assessed professionally." },
  { dim: "texture", skincare: "Gentle exfoliation once or twice a week can smooth surface texture." },
  { dim: "pores", skincare: "Consistent cleansing and oil control help pore visibility." },
  { dim: "oiliness", skincare: "Use a lightweight, oil-free moisturizer and blotting rather than over-washing." },
  { dim: "dryness", skincare: "Layer a richer moisturizer on damp skin; consider a humidifier in dry rooms." },
  { dim: "fine-lines", skincare: "Hydration plus daily sunscreen slows fine-line progression." },
  { dim: "wrinkles", skincare: "Sun protection and a consistent moisturizing routine matter most.", treatment: "A professional can outline options if wrinkle depth concerns you." },
  { dim: "under-eye", skincare: "Sleep, hydration, and a caffeine-based eye product can reduce under-eye darkness." },
  { dim: "tone-consistency", skincare: "Even application of sunscreen helps tone evenness over time." },
];

export function recommend(dimensions: Record<FaceDimension, DimensionScore>): { skincare: string[]; treatments: string[] } {
  const skincare = ["Daily broad-spectrum sunscreen."];
  const treatments: string[] = [];
  for (const rule of RULES) {
    if (dimensions[rule.dim].score >= HIGH) {
      skincare.push(rule.skincare);
      if (rule.treatment) treatments.push(rule.treatment);
    }
  }
  return { skincare: [...new Set(skincare)], treatments };
}
```

- [ ] **Step 4 — run, see PASS.** **Step 5 — commit:** `git commit -am "feat(face): deterministic recommendations + disclaimer"`

---

### Task 11: Pipeline orchestrator (per-image analysis + report assembly)

**Files:** Create `ai/face/pipeline.ts` · Test `ai/face/pipeline.test.ts`

- [ ] **Step 1 — failing test:**

```typescript
// ai/face/pipeline.test.ts
import { describe, it, expect } from "vitest";
import { analyzeView, buildFaceReport, PIPELINE_VERSION } from "./pipeline";
import { validateFaceReport } from "../../shared/face";
import { makePixels, addNoise, syntheticGeometry } from "./testing/fixtures";
import type { CapturedView } from "./types";

function capture(angle: CapturedView["angle"]): CapturedView {
  const pixels = makePixels(640, 640, { r: 185, g: 145, b: 125 });
  addNoise(pixels, 25);
  return { angle, pixels, geometry: syntheticGeometry(angle) };
}

describe("analyzeView", () => {
  it("computes stats only for zones visible from the angle", () => {
    const front = analyzeView(capture("front"));
    const profile = analyzeView(capture("left-profile"));
    expect(Object.keys(front.zones).length).toBeGreaterThan(Object.keys(profile.zones).length);
    expect(profile.zones["right-cheek"]).toBeUndefined();
  });
  it("carries quality through", () => {
    const noFace = analyzeView({ ...capture("front"), geometry: null });
    expect(noFace.quality.ok).toBe(false);
    expect(Object.keys(noFace.zones)).toHaveLength(0);
  });
});

describe("buildFaceReport", () => {
  it("assembles a contract-valid report from five captures", () => {
    const views = (["front", "left-45", "right-45", "left-profile", "right-profile"] as const).map(capture);
    const report = buildFaceReport(views.map(analyzeView), { "face-landmarker": "dev" });
    const v = validateFaceReport(report);
    expect(v.ok).toBe(true);
    expect(report.pipelineVersion).toBe(PIPELINE_VERSION);
    expect(report.capture.angles).toHaveLength(5);
    expect(report.explanation).toBeNull();
  });
});
```

- [ ] **Step 2 — run, see FAIL.**
- [ ] **Step 3 — implement:**

```typescript
// ai/face/pipeline.ts
// Orchestrator: CapturedView → AnalyzedView (quality, zones, stats); AnalyzedView[] → FaceReport.
// Pure functions — Phase B feeds real camera frames + MediaPipe geometry into these.
import type { FaceReport } from "../../shared/face";
import { validateCapture } from "./quality/validate";
import { zonesVisibleFrom, maskForZone } from "./landmarks/zones";
import { zoneStats } from "./stats";
import { mergeViews } from "./merge/merge";
import { recommend, FACE_DISCLAIMER } from "./recommend/rules";
import type { AnalyzedView, CapturedView } from "./types";

export const PIPELINE_VERSION = 1;

export function analyzeView(view: CapturedView): AnalyzedView {
  const quality = validateCapture(view.angle, view.pixels, view.geometry);
  const zones: AnalyzedView["zones"] = {};
  if (view.geometry) {
    for (const zone of zonesVisibleFrom(view.angle)) {
      const mask = maskForZone(zone, view.geometry, view.pixels.width, view.pixels.height);
      zones[zone] = zoneStats(zone, view.pixels, mask);
    }
  }
  return { angle: view.angle, quality, zones };
}

export function buildFaceReport(
  views: AnalyzedView[],
  modelVersions: Record<string, string>,
): FaceReport {
  const { dimensions, overall } = mergeViews(views);
  return {
    kind: "face-v2",
    overall,
    dimensions,
    capture: { angles: views.map((v) => ({ angle: v.angle, quality: v.quality })) },
    recommendations: recommend(dimensions),
    explanation: null,      // Phase C fills gemini/builtin
    disclaimer: FACE_DISCLAIMER,
    pipelineVersion: PIPELINE_VERSION,
    modelVersions,
  };
}
```

- [ ] **Step 4 — run, see PASS.** Full gates: `npm run typecheck && npm run typecheck:server && npx vitest run` (face-mode legacy tests unaffected — nothing existing was modified).
- [ ] **Step 5 — commit:** `git commit -am "feat(face): pipeline orchestrator — captures to contract-valid FaceReport"`

---

## Self-review checklist
- [ ] Every spec §3 stage present: quality ✓ (T5) · landmarks/zones ✓ (T3) · skin-region extraction ✓ (masks, T3/T4) · per-image analysis ✓ (T11) · merge ✓ (T9) · report ✓ (T11)
- [ ] All 11 result dimensions + overall + confidence + recommendations + disclaimer ✓ (T1, T6–T10)
- [ ] D1 seam: `ANALYZERS` registry, one swappable entry per dimension ✓ (T8)
- [ ] No MediaPipe/DOM dependency anywhere in `ai/face/` — all tests run in plain vitest ✓
- [ ] Evidence strings name the pixel metric (camera-honest invariant) ✓
- [ ] Identifier consistency: `ZoneStats` fields used by analyzers match Task 2 definitions ✓
