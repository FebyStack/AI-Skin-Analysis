import { describe, it, expect } from "vitest";
import { acneAnalyzer, underEyeAnalyzer } from "./spots";
import { ANALYZERS } from "./index";
import { FACE_DIMENSIONS } from "../../../shared/face";
import type { AnalyzedView, ZoneStats } from "../types";

function stats(zone: ZoneStats["zone"], over: Partial<ZoneStats> = {}): ZoneStats {
    return {
        zone, pixelCount: 1000, meanR: 185, meanG: 145, meanB: 125, meanLuma: 0.6, lumaStd: 0.05,
        rednessIdx: 0.12, highFreqRatio: 0.008, darkSpotRatio: 0.01, brightSpotRatio: 0.01, redSpotRatio: 0.01, ...over
    };
}
const view = (zones: ZoneStats[]): AnalyzedView =>
    ({ angle: "front", quality: { ok: true, issues: [] }, zones: Object.fromEntries(zones.map((z) => [z.zone, z])) });

describe("spot analyzers", () => {
    it("acne rises with red-spot clusters", () => {
        const clear = acneAnalyzer([view([stats("left-cheek"), stats("forehead"), stats("chin")])]);
        const breakout = acneAnalyzer([view([stats("left-cheek", { redSpotRatio: 0.1 }), stats("forehead", { redSpotRatio: 0.08 }), stats("chin", { redSpotRatio: 0.12 })])]);
        expect(breakout.score).toBeGreaterThan(clear.score);
    });
    it("under-eye keys on darkness relative to cheek luma", () => {
        const rested = underEyeAnalyzer([view([stats("under-eye", { meanLuma: 0.58 }), stats("left-cheek", { meanLuma: 0.6 })])]);
        const tired = underEyeAnalyzer([view([stats("under-eye", { meanLuma: 0.35 }), stats("left-cheek", { meanLuma: 0.6 })])]);
        expect(tired.score).toBeGreaterThan(rested.score);
    });
});

describe("registry", () => {
    it("covers every contract dimension exactly", () => {
        expect(Object.keys(ANALYZERS).sort()).toEqual([...FACE_DIMENSIONS].sort());
    });
}); 