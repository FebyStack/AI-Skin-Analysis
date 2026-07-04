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
