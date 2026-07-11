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
    const dims = { ...goldenFaceReport().dimensions } as Record<string, unknown>;
    delete dims["acne"];
    expect(validateFaceReport({ ...goldenFaceReport(), dimensions: dims }).ok).toBe(false);
  });
  it("rejects out-of-range scores", () => {
    const g = goldenFaceReport();
    g.overall.score = 1.5;
    expect(validateFaceReport(g).ok).toBe(false);
  });
});
