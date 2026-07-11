import { describe, it, expect } from "vitest";
import { analyzeView, buildFaceReport, PIPELINE_VERSION } from "./pipeline";
import { validateFaceReport } from "../../shared/face";
import { makePixels, addNoise, syntheticGeometry } from "./testing/fixtures";
import type { CapturedView } from "./types";

function capture(angle: CapturedView["angle"]): CapturedView {
    const pixels = makePixels(640, 640, { r: 185, g: 145, b: 125 });
    addNoise(pixels, 25);
    return { angle, pixels, geometry: syntheticGeometry(angle) };
}

describe("analyzeView", () => {
    it("computes stats only for zones visible from the angle", () => {
        const front = analyzeView(capture("front"));
        const profile = analyzeView(capture("left-profile"));
        expect(Object.keys(front.zones).length).toBeGreaterThan(Object.keys(profile.zones).length);
        expect(profile.zones["right-cheek"]).toBeUndefined();
    });
    it("carries quality through", () => {
        const noFace = analyzeView({ ...capture("front"), geometry: null });
        expect(noFace.quality.ok).toBe(false);
        expect(Object.keys(noFace.zones)).toHaveLength(0);
    });
});

describe("buildFaceReport", () => {
    it("assembles a contract-valid report from five captures", () => {
        const views = (["front", "left-45", "right-45", "left-profile", "right-profile"] as const).map(capture);
        const report = buildFaceReport(views.map(analyzeView), { "face-landmarker": "dev" });
        const v = validateFaceReport(report);
        expect(v.ok).toBe(true);
        expect(report.pipelineVersion).toBe(PIPELINE_VERSION);
        expect(report.capture.angles).toHaveLength(5);
        expect(report.explanation).toBeNull();
    });
});