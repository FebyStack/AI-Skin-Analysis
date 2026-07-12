import { describe, it, expect } from "vitest";
import golden from "../ai/evaluation/fixtures/golden-lesion.json";
import { validateLesionAnalysis } from "./lesion";

describe("validateLesionAnalysis", () => {
  it("accepts the golden service output and normalizes snake→camel", () => {
    const r = validateLesionAnalysis(golden);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.analysis.wholeImageFallback).toBe(true);
      expect(r.analysis.lesions[0].detectorConfidence).toBeNull();
    }
  });

  it("normalizes a real bbox + detector_confidence", () => {
    const withBox = {
      lesions: [
        {
          bbox: [1, 2, 3, 4],
          detector_confidence: 0.9,
          classification: { predicted: "BCC", confidence: 0.5, top: [{ label: "BCC", confidence: 0.5 }] },
        },
      ],
      whole_image_fallback: false,
      model: { classifier: "c", detector: "d" },
    };
    const r = validateLesionAnalysis(withBox);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.analysis.lesions[0].bbox).toEqual([1, 2, 3, 4]);
      expect(r.analysis.lesions[0].detectorConfidence).toBe(0.9);
      expect(r.analysis.wholeImageFallback).toBe(false);
    }
  });

  it("rejects empty lesions", () => {
    expect(validateLesionAnalysis({ ...golden, lesions: [] }).ok).toBe(false);
  });

  it("rejects out-of-range confidence", () => {
    const bad = structuredClone(golden);
    bad.lesions[0].classification.confidence = 1.5;
    expect(validateLesionAnalysis(bad).ok).toBe(false);
  });

  it("rejects a malformed model block", () => {
    expect(validateLesionAnalysis({ ...golden, model: { classifier: "c" } }).ok).toBe(false);
  });
});
