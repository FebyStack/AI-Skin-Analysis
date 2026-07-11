import { describe, it, expect } from "vitest";
import type { LesionAnalysis } from "../../../shared/lesion";
import { builtinLesionExplanation, LESION_DISCLAIMER } from "./lesion-education";

function analysis(top: { label: string; confidence: number }[]): LesionAnalysis {
  return {
    lesions: [{ bbox: null, detectorConfidence: null, classification: { predicted: top[0]?.label ?? null, confidence: top[0]?.confidence ?? 0, top } }],
    wholeImageFallback: true,
    model: { classifier: "efficientnet_b1-isic2019", detector: "yolo11n-generic" },
  };
}

describe("builtinLesionExplanation", () => {
  it("melanoma → urgent referral, disclaimer, builtin source", () => {
    const e = builtinLesionExplanation(analysis([{ label: "MEL", confidence: 0.7 }]));
    expect(e.referral.recommended).toBe(true);
    expect(e.referral.urgency).toBe("urgent");
    expect(e.source).toBe("builtin");
    expect(e.disclaimer).toBe(LESION_DISCLAIMER);
  });

  it("benign nevus → routine, no forced referral, never claims certainty", () => {
    const e = builtinLesionExplanation(analysis([{ label: "NEV", confidence: 0.9 }]));
    expect(e.referral.urgency).toBe("routine");
    expect(e.referral.recommended).toBe(false);
    expect(e.patientSummary).not.toMatch(/\b(definitely|certainly|is cancer)\b/i);
  });

  it("benign top-1 but malignant in top-k still forces referral", () => {
    const e = builtinLesionExplanation(analysis([{ label: "NEV", confidence: 0.5 }, { label: "MEL", confidence: 0.3 }]));
    expect(e.referral.recommended).toBe(true);
  });

  it("unknown prediction → inconclusive guidance with referral", () => {
    const e = builtinLesionExplanation(analysis([{ label: "???", confidence: 0.4 }]));
    expect(e.patientSummary).toMatch(/inconclusive/i);
    expect(e.referral.recommended).toBe(true);
  });

  it("every known class has authored content", () => {
    for (const label of ["MEL", "BCC", "SCC", "ACK", "SEK", "NEV"]) {
      const e = builtinLesionExplanation(analysis([{ label, confidence: 0.8 }]));
      expect(e.education.length, label).toBeGreaterThan(20);
    }
  });
});
