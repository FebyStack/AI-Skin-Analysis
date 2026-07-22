import { describe, it, expect } from "vitest";
import { FACE_DIMENSIONS, type FaceDimension, type FaceReport, type SkinType } from "../../../shared/face";
import { builtinFaceExplanation, BUILTIN_FACE_VERSION } from "./face-education";

// Minimal report: every dimension at `base`, with `overrides` on top.
function report(base: number, overall: number, overrides: Partial<Record<FaceDimension, number>> = {}, skinType?: SkinType): FaceReport {
  const dimensions = Object.fromEntries(
    FACE_DIMENSIONS.map((d) => [d, { score: overrides[d] ?? base, confidence: 0.9, perZone: [], evidence: "test" }]),
  ) as FaceReport["dimensions"];
  return {
    kind: "face-v2",
    overall: { score: overall, confidence: 0.9 },
    dimensions,
    skinType: skinType ? { type: skinType, confidence: 0.8, evidence: "test" } : undefined,
    capture: { angles: [] },
    recommendations: { skincare: [], treatments: [] },
    explanation: null,
    disclaimer: "not a diagnosis",
    pipelineVersion: 1,
    modelVersions: {},
  };
}

const FORBIDDEN = [/\byou have\b/i, /\bdiagnos(is|ed|e)\b/i, /\bprescri(be|ption|bed)\b/i, /\bbenign\b/i, /\bmalignan(t|cy)\b/i, /\bcancer(ous)?\b/i];

describe("builtinFaceExplanation", () => {
  it("calm skin: says calm, lists no areas, no referral", () => {
    const e = builtinFaceExplanation(report(0.1, 0.15));
    expect(e.patientSummary).toMatch(/calm/i);
    expect(e.patientSummary).not.toMatch(/clearest signal/i);
    expect(e.patientSummary).not.toMatch(/dermatologist/i);
    expect(e.source).toBe("builtin");
    expect(e.promptVersion).toBe(BUILTIN_FACE_VERSION);
  });

  it("high overall: names top signal and refers to a dermatologist", () => {
    const e = builtinFaceExplanation(report(0.2, 0.6, { acne: 0.8 }));
    expect(e.patientSummary).toMatch(/acne/i);
    expect(e.patientSummary).toMatch(/dermatologist/i);
  });

  it("one strong dimension alone triggers a referral", () => {
    const e = builtinFaceExplanation(report(0.1, 0.3, { redness: 0.75 }));
    expect(e.patientSummary).toMatch(/dermatologist/i);
  });

  it("skin type present: names it and adds its care line", () => {
    const e = builtinFaceExplanation(report(0.1, 0.15, {}, "oily"));
    expect(e.patientSummary).toMatch(/oily/i);
    expect(e.education).toMatch(/oil-free/i);
  });

  it("never uses diagnosis language", () => {
    for (const r of [report(0.1, 0.15), report(0.3, 0.6, { acne: 0.9 }, "dry")]) {
      const e = builtinFaceExplanation(r);
      for (const re of FORBIDDEN) {
        expect(`${e.patientSummary} ${e.education}`).not.toMatch(re);
      }
    }
  });
});
