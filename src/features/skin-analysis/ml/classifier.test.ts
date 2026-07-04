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
