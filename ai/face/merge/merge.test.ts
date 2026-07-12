import { describe, it, expect } from "vitest";
import { mergeViews, OVERALL_WEIGHTS, parsingConfidenceBoost } from "./merge";
import { FACE_DIMENSIONS } from "../../../shared/face";
import type { AnalyzedView, ZoneStats } from "../types";

function stats(zone: ZoneStats["zone"], over: Partial<ZoneStats> = {}): ZoneStats {
    return {
        zone, pixelCount: 1000, meanR: 185, meanG: 145, meanB: 125, meanLuma: 0.6, lumaStd: 0.05,
        rednessIdx: 0.12, highFreqRatio: 0.008, darkSpotRatio: 0.01, brightSpotRatio: 0.01, redSpotRatio: 0.01, ...over
    };
}
const view = (angle: AnalyzedView["angle"], zones: ZoneStats[], ok = true, maskSource?: AnalyzedView["maskSource"], maskQuality?: number): AnalyzedView =>
    ({ angle, quality: { ok, issues: ok ? [] : ["blur"] }, zones: Object.fromEntries(zones.map((z) => [z.zone, z])), maskSource, maskQuality });

const fullFront = () => view("front", [stats("forehead"), stats("nose"), stats("left-cheek"), stats("right-cheek"), stats("chin"), stats("periorbital"), stats("under-eye")]);

describe("mergeViews", () => {
    it("produces every dimension with 0..1 scores", () => {
        const m = mergeViews([fullFront()]);
        for (const d of FACE_DIMENSIONS) {
            expect(m.dimensions[d].score).toBeGreaterThanOrEqual(0);
            expect(m.dimensions[d].score).toBeLessThanOrEqual(1);
        }
    });
    it("more angles raise confidence", () => {
        const one = mergeViews([fullFront()]);
        const three = mergeViews([fullFront(), view("left-45", [stats("left-cheek"), stats("forehead")]), view("right-45", [stats("right-cheek"), stats("forehead")])]);
        expect(three.dimensions.redness.confidence).toBeGreaterThanOrEqual(one.dimensions.redness.confidence);
        expect(three.overall.confidence).toBeGreaterThan(one.overall.confidence);
    });
    it("bad-quality views are excluded from analysis", () => {
        const clean = mergeViews([fullFront()]);
        const withBad = mergeViews([fullFront(), view("left-45", [stats("left-cheek", { rednessIdx: 0.9 })], false)]);
        expect(withBad.dimensions.redness.score).toBeCloseTo(clean.dimensions.redness.score, 5);
    });
    it("overall weights cover all dimensions and sum to 1", () => {
        expect(Object.keys(OVERALL_WEIGHTS).sort()).toEqual([...FACE_DIMENSIONS].sort());
        const sum = Object.values(OVERALL_WEIGHTS).reduce((a, b) => a + b, 0);
        expect(sum).toBeCloseTo(1, 5);
    });
    it("overall score improves (drops) when dimensions are calm", () => {
        const calm = mergeViews([fullFront()]);
        const angry = mergeViews([view("front", [stats("forehead", { brightSpotRatio: 0.3 }), stats("nose", { brightSpotRatio: 0.3 }), stats("left-cheek", { rednessIdx: 0.4, redSpotRatio: 0.2 }), stats("right-cheek", { rednessIdx: 0.4, redSpotRatio: 0.2 }), stats("chin"), stats("periorbital", { highFreqRatio: 0.06 }), stats("under-eye", { meanLuma: 0.3 })])]);
        expect(angry.overall.score).toBeGreaterThan(calm.overall.score);
    });
    it("parsed masks raise confidence vs landmark-only", () => {
        const landmark = mergeViews([fullFront()]);
        const parsed = mergeViews([{ ...fullFront(), maskSource: "parsing", maskQuality: 1 }]);
        expect(parsed.dimensions.redness.confidence).toBeGreaterThan(landmark.dimensions.redness.confidence);
        expect(parsingConfidenceBoost([{ ...fullFront(), maskSource: "parsing", maskQuality: 1 }])).toBeGreaterThan(1);
    });
});