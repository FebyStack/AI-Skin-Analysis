import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  softmax,
  logitsToFindings,
  pickExecutionProviders,
  preprocess,
  MODEL_INPUT_SIZE,
  NORM,
} from "./classifier";
import { LABELS } from "./labels";

// The exported graph is the bare network, so the browser must reproduce
// serve_transforms() — any drift is silent train/serve skew.
describe("preprocess", () => {
  const py = readFileSync(resolve(__dirname, "../training/transforms.py"), "utf8");
  const pyTuple = (key: string) =>
    py.match(new RegExp(`${key}=\\(([^)]*)\\)`))![1].split(",").map(Number);

  it("uses IMG_SIZE and NORM from ai/training/transforms.py", () => {
    expect(MODEL_INPUT_SIZE).toBe(Number(py.match(/^IMG_SIZE = (\d+)$/m)![1]));
    expect(NORM).toEqual({ mean: pyTuple("mean"), std: pyTuple("std") });
  });

  it("resizes like A.Resize (cv2 bilinear, pixel centres), then normalises", () => {
    // 2×1 black|white image → 224 wide. Golden row from cv2 via serve_transforms():
    // nearest-neighbour would jump 0→255 at x=112; align-corners would lift x=55.
    const golden = [[0, 0], [55, 0], [111, 126], [112, 128], [168, 255], [223, 255]];
    const out = preprocess(new Uint8ClampedArray([0, 0, 0, 255, 255, 255, 255, 255]), 2, 1);
    const plane = MODEL_INPUT_SIZE ** 2;
    for (let c = 0; c < 3; c++) {
      for (const [x, v] of golden) {
        const px = (out[c * plane + x] * NORM.std[c] + NORM.mean[c]) * 255;
        expect(Math.abs(px - v)).toBeLessThanOrEqual(1); // cv2 rounding varies ±1 by platform
      }
    }
  });
});

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
