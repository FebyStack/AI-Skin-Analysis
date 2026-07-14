import { describe, it, expect } from "vitest";
import type { LesionAnalysis } from "../../shared/lesion";
import {
  buildLesionPrompt,
  checkLesionExplanationGuardrails,
  explainLesion,
  LESION_EXPLAIN_PROMPT_VERSION,
} from "./lesion-explainer";

function analysis(label: string, confidence = 0.8): LesionAnalysis {
  return {
    lesions: [{ bbox: null, detectorConfidence: null, localizationConfidence: 0.2, classification: { predicted: label, confidence, top: [{ label, confidence }] } }],
    wholeImageFallback: true,
    model: { classifier: "efficientnet_b1-isic2019", detector: "yolo11n-generic" },
  };
}

const goodMel = {
  patientSummary: "The analysis suggests features associated with melanoma; a professional must confirm.",
  education: "Melanoma arises from pigment cells...",
  referral: { recommended: true, urgency: "urgent", reason: "possible melanoma" },
  disclaimer: "This is not a diagnosis.",
  source: "gemini",
  promptVersion: LESION_EXPLAIN_PROMPT_VERSION,
};

describe("buildLesionPrompt", () => {
  it("embeds the analysis JSON and forbids diagnosis/certainty", () => {
    const p = buildLesionPrompt(analysis("MEL"));
    expect(p).toContain('"MEL"');
    expect(p).toMatch(/do not diagnose/i);
  });
});

describe("checkLesionExplanationGuardrails", () => {
  it("passes a compliant explanation", () => {
    expect(checkLesionExplanationGuardrails(goodMel as never, analysis("MEL")).ok).toBe(true);
  });
  it("rejects certainty language", () => {
    const bad = { ...goodMel, patientSummary: "You definitely have melanoma." };
    expect(checkLesionExplanationGuardrails(bad as never, analysis("MEL")).ok).toBe(false);
  });
  it("rejects treatment advice", () => {
    const bad = { ...goodMel, education: "Apply 5 mg of the cream twice daily." };
    expect(checkLesionExplanationGuardrails(bad as never, analysis("MEL")).ok).toBe(false);
  });
  it("rejects missing referral when malignant is present", () => {
    const bad = { ...goodMel, referral: { recommended: false, urgency: "routine", reason: "n/a" } };
    expect(checkLesionExplanationGuardrails(bad as never, analysis("MEL")).ok).toBe(false);
  });
});

describe("explainLesion", () => {
  it("returns a validated gemini explanation from a good provider", async () => {
    const e = await explainLesion(analysis("MEL"), async () => JSON.stringify(goodMel));
    expect(e?.source).toBe("gemini");
  });
  it("retries once then returns null on persistent garbage", async () => {
    let calls = 0;
    const e = await explainLesion(analysis("NEV"), async () => { calls++; return "not json"; });
    expect(e).toBeNull();
    expect(calls).toBe(2);
  });
  it("rejects (returns null) a provider explanation that violates guardrails", async () => {
    const bad = { ...goodMel, referral: { recommended: false, urgency: "routine", reason: "n/a" } };
    const e = await explainLesion(analysis("MEL"), async () => JSON.stringify(bad));
    expect(e).toBeNull();
  });
});
