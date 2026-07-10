import { describe, it, expect } from "vitest";
import {
  meanLuma,
  estimateSharpness,
  assessQuality,
  buildQualityGuidance,
  QUALITY_THRESHOLDS,
} from "./quality";

function solid(r: number, g: number, b: number, px: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(px * 4);
  for (let i = 0; i < px; i++) {
    out[i * 4] = r;
    out[i * 4 + 1] = g;
    out[i * 4 + 2] = b;
    out[i * 4 + 3] = 255;
  }
  return out;
}

describe("meanLuma", () => {
  it("is ~1 for white and ~0 for black", () => {
    expect(meanLuma(solid(255, 255, 255, 4))).toBeCloseTo(1, 2);
    expect(meanLuma(solid(0, 0, 0, 4))).toBeCloseTo(0, 2);
  });
});

describe("estimateSharpness", () => {
  it("is 0 for a flat image and higher for an edgy one", () => {
    const flat = [0.5, 0.5, 0.5, 0.5];
    const edgy = [0, 1, 0, 1];
    expect(estimateSharpness(flat, 2, 2)).toBeCloseTo(0, 5);
    expect(estimateSharpness(edgy, 2, 2)).toBeGreaterThan(0.4);
  });
});

describe("assessQuality", () => {
  it("passes a well-lit, sharp image with a region", () => {
    const r = assessQuality({
      brightness: 0.5,
      sharpness: 0.1,
      regionFound: true,
      width: 640,
      height: 480,
      glareRatio: 0.01,
      skinCoverage: 0.2,
    });
    expect(r.ok).toBe(true);
    expect(r.issues).toEqual([]);
    expect(r.guidance).toBe("");
  });

  it("flags a dark image", () => {
    const r = assessQuality({
      brightness: 0.05,
      sharpness: 0.1,
      regionFound: true,
      width: 640,
      height: 480,
      glareRatio: 0.01,
      skinCoverage: 0.2,
    });
    expect(r.ok).toBe(false);
    expect(r.issues).toContain("too-dark");
  });

  it("flags a bright image", () => {
    const r = assessQuality({
      brightness: 0.98,
      sharpness: 0.1,
      regionFound: true,
      width: 640,
      height: 480,
      glareRatio: 0.01,
      skinCoverage: 0.2,
    });
    expect(r.issues).toContain("too-bright");
  });

  it("flags a blurry image", () => {
    const r = assessQuality({
      brightness: 0.5,
      sharpness: QUALITY_THRESHOLDS.minSharpness / 2,
      regionFound: true,
      width: 640,
      height: 480,
      glareRatio: 0.01,
      skinCoverage: 0.2,
    });
    expect(r.issues).toContain("blur");
  });

  it("flags a low-resolution image and unsupported aspect ratio", () => {
    const r = assessQuality({
      brightness: 0.5,
      sharpness: 0.1,
      regionFound: true,
      width: 160,
      height: 120,
      glareRatio: 0.01,
      skinCoverage: 0.2,
    });
    expect(r.issues).toContain("low-resolution");
  });

  it("flags an unsupported aspect ratio", () => {
    const r = assessQuality({
      brightness: 0.5,
      sharpness: 0.1,
      regionFound: true,
      width: 900,
      height: 200,
      glareRatio: 0.01,
      skinCoverage: 0.2,
    });
    expect(r.issues).toContain("unsupported-aspect-ratio");
  });

  it("flags a missing region", () => {
    const r = assessQuality({
      brightness: 0.5,
      sharpness: 0.1,
      regionFound: false,
      width: 640,
      height: 480,
      glareRatio: 0.01,
      skinCoverage: 0,
    });
    expect(r.issues).toContain("no-region");
  });

  it("builds user-friendly guidance", () => {
    expect(buildQualityGuidance(["too-bright", "glare", "blur"])).toMatch(/too bright/i);
    expect(buildQualityGuidance(["no-region"])).toMatch(/fill more of the frame/i);
  });
});
