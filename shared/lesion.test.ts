import { describe, it, expect } from "vitest";
import golden from "../ai/evaluation/fixtures/golden-lesion.json";
import { validateLesionAnalysis, hasMalignantSignal } from "./lesion";

describe("validateLesionAnalysis", () => {
  it("accepts the golden service output and normalizes snake→camel", () => {
    const r = validateLesionAnalysis(golden);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.analysis.wholeImageFallback).toBe(true);
      expect(r.analysis.lesions[0].detectorConfidence).toBeNull();
      expect(r.analysis.lesions[0].localizationConfidence).toBe(0.2);
    }
  });

  it("normalizes a real bbox + detector_confidence", () => {
    const withBox = {
      lesions: [
        {
          bbox: [1, 2, 3, 4],
          detector_confidence: 0.9,
          localization_confidence: 0.9,
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
      expect(r.analysis.lesions[0].localizationConfidence).toBe(0.9);
      expect(r.analysis.wholeImageFallback).toBe(false);
    }
  });

  it("rejects a missing localization_confidence", () => {
    const bad = structuredClone(golden) as { lesions: Record<string, unknown>[] };
    delete bad.lesions[0].localization_confidence;
    expect(validateLesionAnalysis(bad).ok).toBe(false);
  });

  it("never lets localizationConfidence influence classification.confidence — hasMalignantSignal safety invariant", () => {
    // A whole-image fallback with a strong malignant-leaning top prediction must
    // keep its raw classification confidence untouched by the low localization
    // score, or hasMalignantSignal()'s 0.15 floor could be silently defeated.
    const r = validateLesionAnalysis(golden); // golden IS a whole-image-fallback MEL case
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.analysis.lesions[0].localizationConfidence).toBeLessThan(0.3);
      expect(r.analysis.lesions[0].classification.confidence).toBe(0.72);
      expect(hasMalignantSignal(r.analysis)).toBe(true);
    }
  });

  it("defaults segmented to false when absent — not a validation error", () => {
    // The golden fixture predates the segmented field entirely; that must
    // still validate as a normal, valid "not segmented" response, not fail.
    const r = validateLesionAnalysis(golden);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.analysis.lesions[0].segmented).toBe(false);
  });

  it("normalizes a segmented detection with a segmenter model tag", () => {
    const segmented = {
      lesions: [
        {
          bbox: [5, 5, 20, 20],
          detector_confidence: 0.6,
          localization_confidence: 0.95,
          segmented: true,
          classification: { predicted: "MEL", confidence: 0.8, top: [{ label: "MEL", confidence: 0.8 }] },
        },
      ],
      whole_image_fallback: false,
      model: { classifier: "c", detector: "d", segmenter: "mobile_sam-vit_t" },
    };
    const r = validateLesionAnalysis(segmented);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.analysis.lesions[0].segmented).toBe(true);
      expect(r.analysis.model.segmenter).toBe("mobile_sam-vit_t");
    }
  });

  it("accepts a response with no model.segmenter at all (optional field)", () => {
    const r = validateLesionAnalysis(golden);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.analysis.model.segmenter).toBeUndefined();
  });

  it("rejects a non-string model.segmenter", () => {
    const bad = { ...golden, model: { ...golden.model, segmenter: 42 } };
    expect(validateLesionAnalysis(bad).ok).toBe(false);
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
