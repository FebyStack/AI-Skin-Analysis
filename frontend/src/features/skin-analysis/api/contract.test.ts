import { describe, it, expect } from "vitest";
import { validateAnalysisReport, DIMENSION_KEYS, FACE_ZONES } from "@shared/contract";
import golden from "@ai/evaluation/fixtures/golden-report.json";

describe("client contract mirror", () => {
  it("accepts the same golden report the server accepts", () => {
    expect(validateAnalysisReport(golden).ok).toBe(true);
  });

  it("agrees on vocabulary sizes", () => {
    expect(DIMENSION_KEYS).toHaveLength(12);
    expect(FACE_ZONES).toHaveLength(7);
  });
});
