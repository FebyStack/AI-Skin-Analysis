# On-device ML Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the on-device intelligence — an image **quality gate** that rejects unusable photos, and an **ONNX classifier** running in a web worker that produces the independent second-opinion `Finding[]`.

**Architecture:** All ML logic is split into pure, injectable cores (scoring, softmax, label mapping, worker message handling) that are unit-tested without a browser, plus thin wrappers around ONNX Runtime Web and the DOM that carry real pixels. The classifier runs in a web worker so inference never blocks the camera UI. The quality gate runs on the captured still before analysis; failures route back to a machine error state. This plan depends on Plan 1 (types, scan-machine, CaptureFlow) and feeds Plan 4 (verdict merge consumes the classifier's `Finding[]`).

**Tech Stack:** onnxruntime-web (WASM + WebGPU EP), @mediapipe/tasks-vision (region presence), TypeScript, Vitest.

---

## Prerequisites

Plan 1 (Foundation & Capture) must be complete: `types.ts`, `store/scan-machine.ts`, `privacy/redact.ts`, and `components/capture/CaptureFlow.tsx` exist and `npm run verify` passes.

## File Structure

Files created/modified in this plan:

- Modify: `src/features/skin-analysis/types.ts` — add `QualityIssue`, `QualityReport`, `ClassifierOutput`
- Create: `src/features/skin-analysis/ml/quality.ts` (+ test) — pure image-quality scoring
- Create: `src/features/skin-analysis/ml/labels.ts` (+ test) — class taxonomy + severity mapping
- Create: `src/features/skin-analysis/ml/classifier.ts` (+ test) — softmax, findings mapping, EP selection; real ORT session wrapper
- Create: `src/features/skin-analysis/ml/worker-protocol.ts` (+ test) — worker message types + pure `runClassification`
- Create: `src/features/skin-analysis/ml/classify.worker.ts` — the web worker (integration, no unit test)
- Create: `src/features/skin-analysis/hooks/use-classifier.ts` — worker lifecycle + one-shot classify
- Create: `src/features/skin-analysis/hooks/use-quality-gate.ts` — runs quality scoring on a captured blob
- Modify: `src/features/skin-analysis/store/scan-machine.ts` — add `qualityRejected` action
- Modify: `src/features/skin-analysis/components/capture/CaptureFlow.tsx` — gate then classify

---

## Task 1: Extend the type contract for ML outputs

**Files:**
- Modify: `src/features/skin-analysis/types.ts`
- Test: `src/features/skin-analysis/ml-types.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/features/skin-analysis/ml-types.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import type { QualityReport, QualityIssue, ClassifierOutput } from "./types";

describe("ml types", () => {
  it("models a passing quality report", () => {
    const r: QualityReport = {
      ok: true,
      issues: [],
      brightness: 0.5,
      sharpness: 0.1,
      regionFound: true,
    };
    expect(r.ok).toBe(true);
  });

  it("models a failing quality report with issues", () => {
    const issues: QualityIssue[] = ["blur", "too-dark"];
    const r: QualityReport = {
      ok: false,
      issues,
      brightness: 0.05,
      sharpness: 0.001,
      regionFound: false,
    };
    expect(r.issues).toContain("blur");
  });

  it("models classifier output as source-tagged findings", () => {
    const out: ClassifierOutput = {
      findings: [
        { id: "acne", label: "Acne", source: "classifier", confidence: 0.6, severity: "mild" },
      ],
    };
    expect(out.findings[0].source).toBe("classifier");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/skin-analysis/ml-types.test.ts`
Expected: FAIL — `QualityReport` / `QualityIssue` / `ClassifierOutput` not exported.

- [ ] **Step 3: Append to `types.ts`**

```ts
export type QualityIssue =
  | "too-dark"
  | "overexposed"
  | "blur"
  | "no-region";

export interface QualityReport {
  ok: boolean;
  issues: QualityIssue[];
  brightness: number; // 0..1 mean luma
  sharpness: number; // 0..1 relative
  regionFound: boolean;
}

export interface ClassifierOutput {
  findings: Finding[];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/features/skin-analysis/ml-types.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/features/skin-analysis/types.ts src/features/skin-analysis/ml-types.test.ts
git commit -m "feat: add ML output types (quality report, classifier output)"
```

---

## Task 2: Quality scoring (pure)

**Files:**
- Create: `src/features/skin-analysis/ml/quality.ts`
- Test: `src/features/skin-analysis/ml/quality.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import {
  meanLuma,
  estimateSharpness,
  assessQuality,
  QUALITY_THRESHOLDS,
} from "./quality";

function solid(r: number, g: number, b: number, px: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(px * 4);
  for (let i = 0; i < px; i++) {
    out[i * 4] = r;
    out[i * 4 + 1] = g;
    out[i * 4 + 2] = b;
    out[i * 4 + 3] = 255;
  }
  return out;
}

describe("meanLuma", () => {
  it("is ~1 for white and ~0 for black", () => {
    expect(meanLuma(solid(255, 255, 255, 4))).toBeCloseTo(1, 2);
    expect(meanLuma(solid(0, 0, 0, 4))).toBeCloseTo(0, 2);
  });
});

describe("estimateSharpness", () => {
  it("is 0 for a flat image and higher for an edgy one", () => {
    const flat = [0.5, 0.5, 0.5, 0.5];
    const edgy = [0, 1, 0, 1];
    expect(estimateSharpness(flat, 2, 2)).toBeCloseTo(0, 5);
    expect(estimateSharpness(edgy, 2, 2)).toBeGreaterThan(0.4);
  });
});

describe("assessQuality", () => {
  it("passes a well-lit, sharp image with a region", () => {
    const r = assessQuality({ brightness: 0.5, sharpness: 0.1, regionFound: true });
    expect(r.ok).toBe(true);
    expect(r.issues).toEqual([]);
  });

  it("flags a dark image", () => {
    const r = assessQuality({ brightness: 0.05, sharpness: 0.1, regionFound: true });
    expect(r.ok).toBe(false);
    expect(r.issues).toContain("too-dark");
  });

  it("flags an overexposed image", () => {
    const r = assessQuality({ brightness: 0.98, sharpness: 0.1, regionFound: true });
    expect(r.issues).toContain("overexposed");
  });

  it("flags a blurry image", () => {
    const r = assessQuality({
      brightness: 0.5,
      sharpness: QUALITY_THRESHOLDS.minSharpness / 2,
      regionFound: true,
    });
    expect(r.issues).toContain("blur");
  });

  it("flags a missing region", () => {
    const r = assessQuality({ brightness: 0.5, sharpness: 0.1, regionFound: false });
    expect(r.issues).toContain("no-region");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/skin-analysis/ml/quality.test.ts`
Expected: FAIL — cannot resolve `./quality`.

- [ ] **Step 3: Write minimal implementation**

```ts
import type { QualityIssue, QualityReport } from "../types";

export const QUALITY_THRESHOLDS = {
  minBrightness: 0.15,
  maxBrightness: 0.95,
  minSharpness: 0.02,
};

export function meanLuma(rgba: Uint8ClampedArray): number {
  const n = rgba.length / 4;
  if (n === 0) return 0;
  let sum = 0;
  for (let i = 0; i < rgba.length; i += 4) {
    sum += 0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2];
  }
  return sum / n / 255;
}

// gray: 0..1 luma per pixel, row-major. Mean absolute neighbour gradient.
export function estimateSharpness(gray: number[], width: number, height: number): number {
  if (width < 2 || height < 2) return 0;
  let sum = 0;
  let count = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width - 1; x++) {
      sum += Math.abs(gray[y * width + x] - gray[y * width + x + 1]);
      count++;
    }
  }
  return count === 0 ? 0 : sum / count;
}

export function assessQuality(
  m: { brightness: number; sharpness: number; regionFound: boolean },
  t = QUALITY_THRESHOLDS,
): QualityReport {
  const issues: QualityIssue[] = [];
  if (m.brightness < t.minBrightness) issues.push("too-dark");
  if (m.brightness > t.maxBrightness) issues.push("overexposed");
  if (m.sharpness < t.minSharpness) issues.push("blur");
  if (!m.regionFound) issues.push("no-region");
  return {
    ok: issues.length === 0,
    issues,
    brightness: m.brightness,
    sharpness: m.sharpness,
    regionFound: m.regionFound,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/features/skin-analysis/ml/quality.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add src/features/skin-analysis/ml/quality.ts src/features/skin-analysis/ml/quality.test.ts
git commit -m "feat: add pure image quality scoring"
```

---

## Task 3: Class taxonomy and severity mapping

**Files:**
- Create: `src/features/skin-analysis/ml/labels.ts`
- Test: `src/features/skin-analysis/ml/labels.test.ts`

The classifier emits one logit per class in `LABELS` order. `lesion: true` classes are the ones the verdict layer (Plan 4) always escalates.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { LABELS, labelAt, LESION_IDS } from "./labels";

describe("labels", () => {
  it("has a stable, non-empty ordered list", () => {
    expect(LABELS.length).toBeGreaterThan(5);
    expect(LABELS[0]).toHaveProperty("id");
    expect(LABELS[0]).toHaveProperty("severity");
  });

  it("maps an index to its label info", () => {
    expect(labelAt(0)).toEqual(LABELS[0]);
  });

  it("marks lesion classes for escalation with attention severity", () => {
    for (const id of LESION_IDS) {
      const info = LABELS.find((l) => l.id === id);
      expect(info?.lesion).toBe(true);
      expect(info?.severity).toBe("attention");
    }
  });

  it("has unique ids", () => {
    const ids = LABELS.map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/skin-analysis/ml/labels.test.ts`
Expected: FAIL — cannot resolve `./labels`.

- [ ] **Step 3: Write minimal implementation**

```ts
import type { Severity } from "../types";

export interface LabelInfo {
  id: string;
  label: string;
  severity: Severity;
  lesion?: boolean;
}

// Order is the model's output order — do not reorder without re-exporting the model.
export const LABELS: LabelInfo[] = [
  { id: "clear", label: "No notable condition", severity: "info" },
  { id: "acne", label: "Acne", severity: "mild" },
  { id: "rosacea", label: "Rosacea", severity: "mild" },
  { id: "eczema", label: "Eczema / atopic dermatitis", severity: "moderate" },
  { id: "contact-dermatitis", label: "Contact dermatitis", severity: "moderate" },
  { id: "psoriasis", label: "Psoriasis", severity: "moderate" },
  { id: "urticaria", label: "Urticaria / hives", severity: "moderate" },
  { id: "tinea", label: "Tinea / fungal infection", severity: "moderate" },
  { id: "hyperpigmentation", label: "Hyperpigmentation", severity: "mild" },
  { id: "vitiligo", label: "Vitiligo", severity: "mild" },
  { id: "wart", label: "Wart", severity: "mild" },
  { id: "suspicious-lesion", label: "Lesion needing evaluation", severity: "attention", lesion: true },
  { id: "pigmented-lesion", label: "Pigmented lesion needing evaluation", severity: "attention", lesion: true },
];

export const LESION_IDS = LABELS.filter((l) => l.lesion).map((l) => l.id);

export function labelAt(index: number): LabelInfo {
  const info = LABELS[index];
  if (!info) throw new Error(`No label at index ${index}`);
  return info;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/features/skin-analysis/ml/labels.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/features/skin-analysis/ml/labels.ts src/features/skin-analysis/ml/labels.test.ts
git commit -m "feat: add classifier label taxonomy and severity map"
```

---

## Task 4: Classifier post-processing and execution-provider selection

**Files:**
- Create: `src/features/skin-analysis/ml/classifier.ts`
- Test: `src/features/skin-analysis/ml/classifier.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { softmax, logitsToFindings, pickExecutionProviders } from "./classifier";
import { LABELS } from "./labels";

describe("softmax", () => {
  it("sums to 1 and is monotonic in inputs", () => {
    const p = softmax([1, 2, 3]);
    const sum = p.reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 6);
    expect(p[2]).toBeGreaterThan(p[0]);
  });
});

describe("logitsToFindings", () => {
  it("drops the 'clear' class and below-threshold classes", () => {
    // Force high prob on 'clear' (index 0) → no findings.
    const logits = LABELS.map((_, i) => (i === 0 ? 10 : 0));
    expect(logitsToFindings(logits, 0.3)).toEqual([]);
  });

  it("returns source=classifier findings sorted by confidence desc", () => {
    // High on 'acne' (1) and 'eczema' (3).
    const logits = LABELS.map((_, i) => (i === 1 ? 6 : i === 3 ? 5 : 0));
    const findings = logitsToFindings(logits, 0.05);
    expect(findings.length).toBeGreaterThanOrEqual(2);
    expect(findings[0].source).toBe("classifier");
    expect(findings[0].confidence).toBeGreaterThanOrEqual(findings[1].confidence);
    expect(findings[0].id).toBe("acne");
  });

  it("carries lesion severity through", () => {
    const idx = LABELS.findIndex((l) => l.id === "suspicious-lesion");
    const logits = LABELS.map((_, i) => (i === idx ? 8 : 0));
    const findings = logitsToFindings(logits, 0.1);
    expect(findings[0].severity).toBe("attention");
  });
});

describe("pickExecutionProviders", () => {
  it("prefers webgpu when available", () => {
    expect(pickExecutionProviders(true)).toEqual(["webgpu", "wasm"]);
  });

  it("falls back to wasm only when webgpu is absent", () => {
    expect(pickExecutionProviders(false)).toEqual(["wasm"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/skin-analysis/ml/classifier.test.ts`
Expected: FAIL — cannot resolve `./classifier`.

- [ ] **Step 3: Write minimal implementation**

```ts
import type { Finding } from "../types";
import { labelAt, LABELS } from "./labels";

export function softmax(logits: number[]): number[] {
  const max = Math.max(...logits);
  const exps = logits.map((l) => Math.exp(l - max));
  const sum = exps.reduce((a, b) => a + b, 0);
  return exps.map((e) => e / sum);
}

const TOP_K = 3;

export function logitsToFindings(logits: number[], threshold: number): Finding[] {
  const probs = softmax(logits);
  return probs
    .map((confidence, index) => ({ info: labelAt(index), confidence }))
    .filter(({ info, confidence }) => info.id !== "clear" && confidence >= threshold)
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, TOP_K)
    .map(({ info, confidence }) => ({
      id: info.id,
      label: info.label,
      source: "classifier" as const,
      confidence,
      severity: info.severity,
    }));
}

export function pickExecutionProviders(hasWebGpu: boolean): string[] {
  return hasWebGpu ? ["webgpu", "wasm"] : ["wasm"];
}

// --- Real ONNX session wrapper (integration; not unit-tested) ---

export interface InferenceFn {
  (rgba: Uint8ClampedArray, width: number, height: number): Promise<number[]>;
}

export const MODEL_INPUT_SIZE = 224;
export const CLASSIFIER_THRESHOLD = 0.3;

// Model URL is configured at build time; a real DermNet/HAM10000-class ONNX
// export (output length === LABELS.length) is placed under public/models/.
const MODEL_URL =
  import.meta.env?.VITE_CLASSIFIER_MODEL_URL ?? "/models/skin-classifier.onnx";

export async function createOnnxInference(): Promise<InferenceFn> {
  const ort = await import("onnxruntime-web");
  const hasWebGpu = typeof navigator !== "undefined" && "gpu" in navigator;
  const session = await ort.InferenceSession.create(MODEL_URL, {
    executionProviders: pickExecutionProviders(hasWebGpu),
  });

  return async (rgba, width, height) => {
    const tensor = preprocess(ort, rgba, width, height);
    const inputName = session.inputNames[0];
    const outputName = session.outputNames[0];
    const result = await session.run({ [inputName]: tensor });
    const data = result[outputName].data as Float32Array;
    if (data.length !== LABELS.length) {
      throw new Error(
        `Model output length ${data.length} != label count ${LABELS.length}`,
      );
    }
    return Array.from(data);
  };
}

// Nearest-neighbour resize to MODEL_INPUT_SIZE, NCHW float32, 0..1 normalised.
function preprocess(
  ort: typeof import("onnxruntime-web"),
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
) {
  const size = MODEL_INPUT_SIZE;
  const chw = new Float32Array(3 * size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const sx = Math.floor((x / size) * width);
      const sy = Math.floor((y / size) * height);
      const si = (sy * width + sx) * 4;
      const di = y * size + x;
      chw[di] = rgba[si] / 255;
      chw[size * size + di] = rgba[si + 1] / 255;
      chw[2 * size * size + di] = rgba[si + 2] / 255;
    }
  }
  return new ort.Tensor("float32", chw, [1, 3, size, size]);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/features/skin-analysis/ml/classifier.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add src/features/skin-analysis/ml/classifier.ts src/features/skin-analysis/ml/classifier.test.ts
git commit -m "feat: add classifier post-processing and ONNX session wrapper"
```

---

## Task 5: Worker message protocol and pure classification handler

**Files:**
- Create: `src/features/skin-analysis/ml/worker-protocol.ts`
- Test: `src/features/skin-analysis/ml/worker-protocol.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { runClassification, type ClassifyRequest } from "./worker-protocol";
import { LABELS } from "./labels";

const req: ClassifyRequest = {
  type: "classify",
  rgba: new Uint8ClampedArray(2 * 2 * 4),
  width: 2,
  height: 2,
};

describe("runClassification", () => {
  it("returns a result message with findings on success", async () => {
    const fakeInfer = async () => LABELS.map((_, i) => (i === 1 ? 6 : 0)); // acne
    const res = await runClassification(req, fakeInfer);
    expect(res.type).toBe("result");
    if (res.type === "result") {
      expect(res.findings[0].id).toBe("acne");
    }
  });

  it("returns an error message when inference throws", async () => {
    const boom = async () => {
      throw new Error("model failed to load");
    };
    const res = await runClassification(req, boom);
    expect(res.type).toBe("error");
    if (res.type === "error") {
      expect(res.message).toMatch(/model failed/);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/skin-analysis/ml/worker-protocol.test.ts`
Expected: FAIL — cannot resolve `./worker-protocol`.

- [ ] **Step 3: Write minimal implementation**

```ts
import type { Finding } from "../types";
import type { InferenceFn } from "./classifier";
import { logitsToFindings, CLASSIFIER_THRESHOLD } from "./classifier";

export interface ClassifyRequest {
  type: "classify";
  rgba: Uint8ClampedArray;
  width: number;
  height: number;
}

export type ClassifyResponse =
  | { type: "result"; findings: Finding[] }
  | { type: "error"; message: string };

export async function runClassification(
  req: ClassifyRequest,
  infer: InferenceFn,
): Promise<ClassifyResponse> {
  try {
    const logits = await infer(req.rgba, req.width, req.height);
    return { type: "result", findings: logitsToFindings(logits, CLASSIFIER_THRESHOLD) };
  } catch (err) {
    return { type: "error", message: err instanceof Error ? err.message : String(err) };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/features/skin-analysis/ml/worker-protocol.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/features/skin-analysis/ml/worker-protocol.ts src/features/skin-analysis/ml/worker-protocol.test.ts
git commit -m "feat: add worker classify protocol and pure handler"
```

---

## Task 6: The web worker (integration wrapper)

**Files:**
- Create: `src/features/skin-analysis/ml/classify.worker.ts`

No unit test — this is the thin worker shell binding the pure handler to a lazily-created ONNX session. It is exercised by the manual smoke test in Task 9.

- [ ] **Step 1: Install ONNX Runtime Web and MediaPipe**

Run: `npm install onnxruntime-web@^1.19.2 @mediapipe/tasks-vision@^0.10.14`
Expected: both added to dependencies.

- [ ] **Step 2: Create `classify.worker.ts`**

```ts
import { createOnnxInference, type InferenceFn } from "./classifier";
import { runClassification, type ClassifyRequest } from "./worker-protocol";

let inferPromise: Promise<InferenceFn> | null = null;

function getInfer(): Promise<InferenceFn> {
  if (!inferPromise) inferPromise = createOnnxInference();
  return inferPromise;
}

self.onmessage = async (e: MessageEvent<ClassifyRequest>) => {
  if (e.data?.type !== "classify") return;
  try {
    const infer = await getInfer();
    const res = await runClassification(e.data, infer);
    self.postMessage(res);
  } catch (err) {
    self.postMessage({
      type: "error",
      message: err instanceof Error ? err.message : String(err),
    });
  }
};
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json src/features/skin-analysis/ml/classify.worker.ts
git commit -m "feat: add classify web worker + onnxruntime-web/mediapipe deps"
```

---

## Task 7: Classifier and quality-gate hooks

**Files:**
- Create: `src/features/skin-analysis/hooks/use-classifier.ts`
- Create: `src/features/skin-analysis/hooks/use-quality-gate.ts`
- Test: `src/features/skin-analysis/hooks/use-quality-gate.test.ts`

The quality-gate hook's pure core — turning a decoded bitmap into a `QualityReport` — is extracted and tested; region detection is injected so the test needs no MediaPipe.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { reportFromPixels } from "./use-quality-gate";

function grayField(value: number, px: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(px * 4);
  for (let i = 0; i < px; i++) {
    out[i * 4] = value;
    out[i * 4 + 1] = value;
    out[i * 4 + 2] = value;
    out[i * 4 + 3] = 255;
  }
  return out;
}

describe("reportFromPixels", () => {
  it("fails a dark, flat image", () => {
    const r = reportFromPixels(grayField(5, 16), 4, 4, true);
    expect(r.ok).toBe(false);
    expect(r.issues).toContain("too-dark");
  });

  it("passes a mid-tone image with texture and a region", () => {
    const px = new Uint8ClampedArray(4 * 4 * 4);
    for (let i = 0; i < 16; i++) {
      const v = i % 2 === 0 ? 40 : 210; // alternating → sharpness
      px[i * 4] = v;
      px[i * 4 + 1] = v;
      px[i * 4 + 2] = v;
      px[i * 4 + 3] = 255;
    }
    const r = reportFromPixels(px, 4, 4, true);
    expect(r.regionFound).toBe(true);
    expect(r.issues).not.toContain("too-dark");
    expect(r.issues).not.toContain("blur");
  });

  it("flags a missing region regardless of exposure", () => {
    const r = reportFromPixels(grayField(128, 16), 4, 4, false);
    expect(r.issues).toContain("no-region");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/skin-analysis/hooks/use-quality-gate.test.ts`
Expected: FAIL — cannot resolve `./use-quality-gate`.

- [ ] **Step 3: Implement `use-quality-gate.ts`**

```ts
import { useCallback } from "react";
import type { QualityReport } from "../types";
import { assessQuality, meanLuma, estimateSharpness } from "../ml/quality";

export function reportFromPixels(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  regionFound: boolean,
): QualityReport {
  const brightness = meanLuma(rgba);
  const gray: number[] = [];
  for (let i = 0; i < rgba.length; i += 4) {
    gray.push((0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2]) / 255);
  }
  const sharpness = estimateSharpness(gray, width, height);
  return assessQuality({ brightness, sharpness, regionFound });
}

async function pixelsFromBlob(
  blob: Blob,
): Promise<{ rgba: Uint8ClampedArray; width: number; height: number }> {
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D canvas unavailable");
  ctx.drawImage(bitmap, 0, 0);
  const { data } = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
  return { rgba: data, width: bitmap.width, height: bitmap.height };
}

// Region detection is deferred to MediaPipe; for the prototype we treat any
// captured frame as region-present (true) and rely on exposure/sharpness gates.
// Swap this for a MediaPipe FaceDetector/ImageSegmenter call in a later pass.
export function useQualityGate() {
  return useCallback(async (blob: Blob): Promise<QualityReport> => {
    const { rgba, width, height } = await pixelsFromBlob(blob);
    return reportFromPixels(rgba, width, height, true);
  }, []);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/features/skin-analysis/hooks/use-quality-gate.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Implement `use-classifier.ts`** (worker lifecycle; no unit test — integration)

```ts
import { useCallback, useEffect, useRef } from "react";
import type { Finding } from "../types";
import type { ClassifyRequest, ClassifyResponse } from "../ml/worker-protocol";

async function pixelsFromBlob(blob: Blob) {
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D canvas unavailable");
  ctx.drawImage(bitmap, 0, 0);
  const { data } = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
  return { rgba: data, width: bitmap.width, height: bitmap.height };
}

export function useClassifier() {
  const workerRef = useRef<Worker | null>(null);

  useEffect(() => {
    const worker = new Worker(
      new URL("../ml/classify.worker.ts", import.meta.url),
      { type: "module" },
    );
    workerRef.current = worker;
    return () => worker.terminate();
  }, []);

  return useCallback(async (blob: Blob): Promise<Finding[]> => {
    const worker = workerRef.current;
    if (!worker) throw new Error("Classifier worker not ready");
    const { rgba, width, height } = await pixelsFromBlob(blob);
    const request: ClassifyRequest = { type: "classify", rgba, width, height };
    return new Promise<Finding[]>((resolve, reject) => {
      const onMessage = (e: MessageEvent<ClassifyResponse>) => {
        worker.removeEventListener("message", onMessage);
        if (e.data.type === "result") resolve(e.data.findings);
        else reject(new Error(e.data.message));
      };
      worker.addEventListener("message", onMessage);
      worker.postMessage(request);
    });
  }, []);
}
```

- [ ] **Step 6: Run the full suite**

Run: `npm test`
Expected: PASS — all suites including the new ML ones.

- [ ] **Step 7: Commit**

```bash
git add src/features/skin-analysis/hooks/use-quality-gate.ts src/features/skin-analysis/hooks/use-quality-gate.test.ts src/features/skin-analysis/hooks/use-classifier.ts
git commit -m "feat: add quality-gate and classifier hooks"
```

---

## Task 8: Add the quality-reject transition and wire the pipeline

**Files:**
- Modify: `src/features/skin-analysis/store/scan-machine.ts`
- Modify: `src/features/skin-analysis/components/capture/CaptureFlow.tsx`
- Test: `src/features/skin-analysis/store/scan-machine.quality.test.ts`

- [ ] **Step 1: Write the failing machine test**

Create `src/features/skin-analysis/store/scan-machine.quality.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { useScanMachine } from "./scan-machine";

describe("scan machine — quality rejection", () => {
  beforeEach(() => useScanMachine.getState().reset());

  it("qualityRejected(blur) → error(blur)", () => {
    useScanMachine.getState().grantConsent();
    useScanMachine.getState().cameraReady();
    useScanMachine.getState().qualityRejected("blur");
    expect(useScanMachine.getState().state).toBe("error");
    expect(useScanMachine.getState().error).toBe("blur");
  });

  it("qualityRejected(too-dark) maps to low-light error", () => {
    useScanMachine.getState().grantConsent();
    useScanMachine.getState().cameraReady();
    useScanMachine.getState().qualityRejected("too-dark");
    expect(useScanMachine.getState().error).toBe("low-light");
  });
});
```

- [ ] **Step 2: Run it to verify failure**

Run: `npx vitest run src/features/skin-analysis/store/scan-machine.quality.test.ts`
Expected: FAIL — `qualityRejected` is not a function.

- [ ] **Step 3: Modify `scan-machine.ts`**

Add the import of `QualityIssue` to the existing type import line:

```ts
import type { CaptureResult, CaptureSource, QualityIssue } from "../types";
```

Add to the `ScanStore` interface (after `captured(...)`):

```ts
  qualityRejected(issue: QualityIssue): void;
```

Add to the store implementation (after the `captured:` line):

```ts
  qualityRejected: (issue) =>
    set({ state: "error", error: issue === "too-dark" ? "low-light" : issue === "overexposed" ? "low-light" : issue === "no-region" ? "no-camera" : "blur" }),
```

> Note: `ScanError` in Plan 1 already includes `"low-light"` and `"blur"`; `no-region` reuses `"no-camera"` messaging. No new `ScanError` members are required.

- [ ] **Step 4: Run the machine test to verify pass**

Run: `npx vitest run src/features/skin-analysis/store/scan-machine.quality.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Modify `CaptureFlow.tsx` to gate + classify**

Replace the whole file with:

```tsx
import { useCallback } from "react";
import { useScanMachine } from "../../store/scan-machine";
import { CameraFeed } from "./CameraFeed";
import { UploadDropzone } from "./UploadDropzone";
import { useQualityGate } from "../../hooks/use-quality-gate";
import { useClassifier } from "../../hooks/use-classifier";
import { stripMetadata, canvasCodec, toCaptureResult } from "../../privacy/redact";
import type { CaptureMode, CaptureResult } from "../../types";

export function CaptureFlow({ mode }: { mode: CaptureMode }) {
  const machine = useScanMachine();
  const runQualityGate = useQualityGate();
  const classify = useClassifier();

  const process = useCallback(
    async (result: CaptureResult) => {
      const report = await runQualityGate(result.blob);
      if (!report.ok) {
        machine.qualityRejected(report.issues[0]);
        return;
      }
      machine.captured(result);
      // Independent second opinion runs off the main thread. The verdict merge
      // that consumes these findings alongside the LLM output lands in Plan 4.
      classify(result.blob).catch(() => machine.analysisFailed());
    },
    [machine, runQualityGate, classify],
  );

  const onUpload = useCallback(
    async (file: File) => {
      const clean = await stripMetadata(file, "image/jpeg", canvasCodec);
      await process(toCaptureResult(clean, mode, "upload"));
    },
    [process, mode],
  );

  const onUnavailable = useCallback(
    (reason: "denied" | "no-camera") =>
      reason === "denied" ? machine.cameraDenied() : machine.noCamera(),
    [machine],
  );

  if (machine.state === "idle") {
    return (
      <button
        onClick={machine.grantConsent}
        className="rounded-lg bg-clinical px-6 py-3 text-sm font-semibold text-white"
      >
        Start scan
      </button>
    );
  }

  const useUpload = machine.captureSource === "upload" || machine.state === "error";

  return (
    <div className="flex flex-col items-center gap-4">
      {machine.state === "error" && (
        <p className="text-sm text-stone-600">
          {machine.error === "blur"
            ? "That photo looked blurry — hold steady and try again, or upload a clearer one."
            : machine.error === "low-light"
              ? "Lighting was too dark or bright — find even light, or upload a photo."
              : "Camera unavailable — upload a photo instead."}
        </p>
      )}
      {useUpload ? (
        <UploadDropzone onFile={onUpload} />
      ) : (
        <CameraFeed mode={mode} onCapture={process} onUnavailable={onUnavailable} />
      )}
      {machine.state === "analyzing" && (
        <p className="text-sm text-clinical">Analyzing… (verdict merge lands in Plan 4)</p>
      )}
    </div>
  );
}
```

- [ ] **Step 6: Run the full suite + typecheck + build**

Run: `npm run verify`
Expected: typecheck passes, all tests pass, build succeeds.

- [ ] **Step 7: Commit**

```bash
git add src/features/skin-analysis/store/scan-machine.ts src/features/skin-analysis/store/scan-machine.quality.test.ts src/features/skin-analysis/components/capture/CaptureFlow.tsx
git commit -m "feat: gate captures on quality then run on-device classifier"
```

---

## Task 9: Model asset placeholder and manual smoke test

**Files:**
- Create: `public/models/README.md`
- Modify: `.gitignore`

The prototype ships without a bundled multi-megabyte model file; the pipeline degrades gracefully (classifier error → `analysisFailed`) until a real ONNX export is dropped in.

- [ ] **Step 1: Create `public/models/README.md`**

```markdown
# Classifier model

Place the ONNX skin-condition classifier here as `skin-classifier.onnx`.

Requirements:
- Output vector length MUST equal the number of entries in
  `src/features/skin-analysis/ml/labels.ts` (`LABELS`), in the same order.
- Input: NCHW float32, 1×3×224×224, RGB normalised to 0..1.

Source options: a DermNet/HAM10000-class model exported to ONNX
(`torch.onnx.export`). Override the path with `VITE_CLASSIFIER_MODEL_URL`.

The `.onnx` binary is gitignored — it is an asset, not source.
```

- [ ] **Step 2: Append to `.gitignore`**

Add these lines:

```
# ML model assets (provided out-of-band, not versioned)
public/models/*.onnx
```

- [ ] **Step 3: Manual smoke test**

Run: `npm run dev`, open the printed `localhost` URL. Accept consent, capture a well-lit photo, and confirm it reaches "Analyzing…". Capture (or upload) a very dark or blurry photo and confirm the quality message appears instead. With no `skin-classifier.onnx` present, confirm the app still gates and shows "Analyzing…" (the classifier promise rejects silently in the background for now — no crash).
Expected: quality gate visibly rejects bad photos; good photos proceed; missing model does not break the UI.

- [ ] **Step 4: Commit**

```bash
git add public/models/README.md .gitignore
git commit -m "docs: document classifier model asset slot"
```

---

## Definition of Done

- `npm run verify` passes: typecheck, all unit tests (quality, labels, classifier, worker-protocol, quality-gate, machine), production build.
- Quality gate rejects too-dark / overexposed / blurry / region-missing captures with a user-facing message, before any analysis.
- Good captures dispatch to the ONNX classifier in a web worker (off the main thread) and produce `source: "classifier"` findings.
- Execution provider is WebGPU when available, WASM otherwise.
- Missing model file degrades gracefully (no crash); real model drops into `public/models/skin-classifier.onnx`.

## What this plan intentionally defers (later plans)

- MediaPipe region detection is stubbed to `regionFound = true`; real face/skin-region detection is a follow-up pass.
- Merging classifier findings with the LLM output — Plan 4 (`verdict.ts`).
- The Supabase Edge Function and Claude analysis/critique — Plan 3.
- Displaying findings in a results UI — Plan 4.
- Persisting results — Plan 5.
