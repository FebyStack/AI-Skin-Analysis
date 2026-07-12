// ai/face/analyzers/color.test.ts
import { describe, it, expect } from "vitest";
import { rednessAnalyzer, oilinessAnalyzer, pigmentationAnalyzer, toneConsistencyAnalyzer } from "./color";
import type { AnalyzedView, ZoneStats } from "../types";

function stats(zone: ZoneStats["zone"], over: Partial<ZoneStats> = {}): ZoneStats {
  return { zone, pixelCount: 1000, meanR: 185, meanG: 145, meanB: 125, meanLuma: 0.6, lumaStd: 0.05,
    rednessIdx: 0.12, highFreqRatio: 0.01, darkSpotRatio: 0.01, brightSpotRatio: 0.01, redSpotRatio: 0.01, ...over };
}
function view(zones: ZoneStats[]): AnalyzedView {
  return { angle: "front", quality: { ok: true, issues: [] },
    zones: Object.fromEntries(zones.map((z) => [z.zone, z])) };
}

describe("color analyzers", () => {
  it("redness scores higher for redder cheeks", () => {
    const calm = rednessAnalyzer([view([stats("left-cheek"), stats("right-cheek")])]);
    const red = rednessAnalyzer([view([stats("left-cheek", { rednessIdx: 0.3, redSpotRatio: 0.2 }), stats("right-cheek", { rednessIdx: 0.3, redSpotRatio: 0.2 })])]);
    expect(red.score).toBeGreaterThan(calm.score);
    expect(red.perZone.length).toBe(2);
    expect(red.evidence).toMatch(/erythema|redness/i);
  });
  it("oiliness keys on T-zone specular highlights", () => {
    const matte = oilinessAnalyzer([view([stats("forehead"), stats("nose")])]);
    const shiny = oilinessAnalyzer([view([stats("forehead", { brightSpotRatio: 0.15 }), stats("nose", { brightSpotRatio: 0.2 })])]);
    expect(shiny.score).toBeGreaterThan(matte.score);
  });
  it("pigmentation keys on dark-spot density", () => {
    const clear = pigmentationAnalyzer([view([stats("left-cheek"), stats("forehead")])]);
    const spotted = pigmentationAnalyzer([view([stats("left-cheek", { darkSpotRatio: 0.12 }), stats("forehead", { darkSpotRatio: 0.1 })])]);
    expect(spotted.score).toBeGreaterThan(clear.score);
  });
  it("tone consistency penalizes luma spread ACROSS zones", () => {
    const even = toneConsistencyAnalyzer([view([stats("forehead", { meanLuma: 0.6 }), stats("chin", { meanLuma: 0.6 })])]);
    const uneven = toneConsistencyAnalyzer([view([stats("forehead", { meanLuma: 0.75 }), stats("chin", { meanLuma: 0.45 })])]);
    expect(uneven.score).toBeGreaterThan(even.score);
  });
  it("no visible zones → zero confidence, not NaN", () => {
    const r = rednessAnalyzer([view([])]);
    expect(r.confidence).toBe(0);
    expect(Number.isNaN(r.score)).toBe(false);
  });
});
