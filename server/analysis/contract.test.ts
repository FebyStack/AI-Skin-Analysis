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
