// ai/face/stats.test.ts
import { describe, it, expect } from "vitest";
import { zoneStats } from "./stats";
import { makePixels, paintRect, addNoise } from "./testing/fixtures";

const fullMask = (w: number, h: number) => new Uint8Array(w * h).fill(1);

describe("zoneStats", () => {
  it("computes means on a flat image", () => {
    const px = makePixels(20, 20, { r: 200, g: 150, b: 120 });
    const s = zoneStats("forehead", px, fullMask(20, 20));
    expect(s.meanR).toBeCloseTo(200, 0);
    expect(s.lumaStd).toBeCloseTo(0, 2);
    expect(s.highFreqRatio).toBeCloseTo(0, 2);
  });
  it("redness index rises with red-dominant pixels", () => {
    const skin = makePixels(20, 20, { r: 190, g: 140, b: 120 });
    const red = makePixels(20, 20, { r: 230, g: 110, b: 100 });
    const sSkin = zoneStats("left-cheek", skin, fullMask(20, 20));
    const sRed = zoneStats("left-cheek", red, fullMask(20, 20));
    expect(sRed.rednessIdx).toBeGreaterThan(sSkin.rednessIdx);
  });
  it("dark spots raise darkSpotRatio", () => {
    const px = makePixels(40, 40, { r: 190, g: 150, b: 130 });
    addNoise(px, 4);
    paintRect(px, { x: 5, y: 5, w: 4, h: 4 }, { r: 60, g: 45, b: 40 });
    paintRect(px, { x: 20, y: 20, w: 4, h: 4 }, { r: 60, g: 45, b: 40 });
    const s = zoneStats("right-cheek", px, fullMask(40, 40));
    expect(s.darkSpotRatio).toBeGreaterThan(0.01);
  });
  it("noise raises highFreqRatio", () => {
    const flat = makePixels(30, 30, { r: 180, g: 140, b: 120 });
    const noisy = makePixels(30, 30, { r: 180, g: 140, b: 120 });
    addNoise(noisy, 40);
    expect(zoneStats("nose", noisy, fullMask(30, 30)).highFreqRatio)
      .toBeGreaterThan(zoneStats("nose", flat, fullMask(30, 30)).highFreqRatio);
  });
  it("empty mask yields pixelCount 0 without NaN", () => {
    const px = makePixels(10, 10, { r: 100, g: 100, b: 100 });
    const s = zoneStats("chin", px, new Uint8Array(100));
    expect(s.pixelCount).toBe(0);
    expect(Number.isNaN(s.meanLuma)).toBe(false);
  });
});
