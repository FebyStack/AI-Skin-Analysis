import { describe, it, expect } from "vitest";
import { textureAnalyzer, poresAnalyzer, fineLinesAnalyzer, wrinklesAnalyzer, drynessAnalyzer } from "./texture";
import type { AnalyzedView, ZoneStats } from "../types";

function stats(zone: ZoneStats["zone"], over: Partial<ZoneStats> = {}): ZoneStats {
    return {
        zone, pixelCount: 1000, meanR: 185, meanG: 145, meanB: 125, meanLuma: 0.6, lumaStd: 0.05,
        rednessIdx: 0.12, highFreqRatio: 0.008, darkSpotRatio: 0.01, brightSpotRatio: 0.01, redSpotRatio: 0.01, ...over
    };
}
const view = (zones: ZoneStats[]): AnalyzedView =>
    ({ angle: "front", quality: { ok: true, issues: [] }, zones: Object.fromEntries(zones.map((z) => [z.zone, z])) });

describe("texture analyzers", () => {
    it("texture rises with high-frequency energy on cheeks", () => {
        const smooth = textureAnalyzer([view([stats("left-cheek"), stats("right-cheek")])]);
        const rough = textureAnalyzer([view([stats("left-cheek", { highFreqRatio: 0.05 }), stats("right-cheek", { highFreqRatio: 0.05 })])]);
        expect(rough.score).toBeGreaterThan(smooth.score);
    });
    it("pores key on nose+cheek micro-contrast", () => {
        const fine = poresAnalyzer([view([stats("nose"), stats("left-cheek")])]);
        const coarse = poresAnalyzer([view([stats("nose", { highFreqRatio: 0.06, darkSpotRatio: 0.05 }), stats("left-cheek", { highFreqRatio: 0.05, darkSpotRatio: 0.04 })])]);
        expect(coarse.score).toBeGreaterThan(fine.score);
    });
    it("fine lines read periorbital+under-eye micro-texture", () => {
        const young = fineLinesAnalyzer([view([stats("periorbital"), stats("under-eye")])]);
        const lined = fineLinesAnalyzer([view([stats("periorbital", { highFreqRatio: 0.04 }), stats("under-eye", { highFreqRatio: 0.04 })])]);
        expect(lined.score).toBeGreaterThan(young.score);
    });
    it("wrinkles read forehead+periorbital with luma-contrast weighting", () => {
        const smooth = wrinklesAnalyzer([view([stats("forehead"), stats("periorbital")])]);
        const deep = wrinklesAnalyzer([view([stats("forehead", { highFreqRatio: 0.05, lumaStd: 0.15 }), stats("periorbital", { highFreqRatio: 0.05, lumaStd: 0.15 })])]);
        expect(deep.score).toBeGreaterThan(smooth.score);
    });
    it("dryness = flaky micro-texture WITHOUT shine", () => {
        const normal = drynessAnalyzer([view([stats("left-cheek"), stats("chin")])]);
        const dry = drynessAnalyzer([view([stats("left-cheek", { highFreqRatio: 0.04, brightSpotRatio: 0.002 }), stats("chin", { highFreqRatio: 0.04, brightSpotRatio: 0.002 })])]);
        const oily = drynessAnalyzer([view([stats("left-cheek", { highFreqRatio: 0.04, brightSpotRatio: 0.2 }), stats("chin", { highFreqRatio: 0.04, brightSpotRatio: 0.2 })])]);
        expect(dry.score).toBeGreaterThan(normal.score);
        expect(dry.score).toBeGreaterThan(oily.score);
    });
});