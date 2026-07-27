import { describe, it, expect } from "vitest";
import {
  candidateBeatsProduction,
  eligibilityOf,
  type EligibilityInput,
} from "./training-governance";

const base: EligibilityInput = {
  status: "approved",
  consentTraining: true,
  labeledCount: 9,
  requiredLabels: 9,
  minQualityScore: 90,
  qualityThreshold: 70,
};

describe("retrain eligibility", () => {
  it("a fully approved, consented, labeled, sharp sample is ready", () => {
    expect(eligibilityOf(base)).toBe("ready");
  });

  it("rejection outranks everything else", () => {
    expect(eligibilityOf({ ...base, status: "rejected" })).toBe("rejected");
  });

  it("without training consent a sample can never be ready", () => {
    expect(eligibilityOf({ ...base, consentTraining: false })).toBe("consent_not_given");
    // even a perfect, approved sample
    expect(eligibilityOf({ ...base, consentTraining: false, minQualityScore: 100 })).toBe(
      "consent_not_given",
    );
  });

  it("flags needs-expert, low quality and missing labels", () => {
    expect(eligibilityOf({ ...base, status: "needs_expert" })).toBe("needs_expert");
    expect(eligibilityOf({ ...base, minQualityScore: 55 })).toBe("low_quality");
    expect(eligibilityOf({ ...base, labeledCount: 4 })).toBe("missing_labels");
  });

  it("a pending or skipped sample is not ready", () => {
    expect(eligibilityOf({ ...base, status: "pending" })).not.toBe("ready");
    expect(eligibilityOf({ ...base, skipTraining: true })).not.toBe("ready");
  });

  it("captures with no metrics aren't penalised for quality", () => {
    expect(eligibilityOf({ ...base, minQualityScore: null })).toBe("ready");
  });
});

describe("deployment gate", () => {
  it("never replaces a better production model", () => {
    expect(candidateBeatsProduction({ macroF1: 0.70 }, { macroF1: 0.80 })).toBe(false);
    expect(candidateBeatsProduction({ macroF1: 0.80 }, { macroF1: 0.80 })).toBe(false);
  });
  it("promotes a genuine improvement, or when nothing is deployed", () => {
    expect(candidateBeatsProduction({ macroF1: 0.85 }, { macroF1: 0.80 })).toBe(true);
    expect(candidateBeatsProduction({ macroF1: 0.10 }, null)).toBe(true);
  });
});
