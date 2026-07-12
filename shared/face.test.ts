// shared/face.test.ts
import { goldenFaceReport } from "./testing/face-fixtures";
import { describe, it, expect } from "vitest";
import {
  FACE_ANGLES, FACE_DIMENSIONS, FACE_ANALYSIS_ZONES,
  validateFaceReport,
} from "./face";

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
