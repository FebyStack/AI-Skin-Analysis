import { describe, it, expect } from "vitest";
import { analyzeView, analyzeViewSync, buildFaceReport, PIPELINE_VERSION } from "./pipeline";
import { validateFaceReport } from "../../shared/face";
import { PARSE } from "./segmentation/labels";
import { makePixels, addNoise, syntheticGeometry } from "./testing/fixtures";
import type { CapturedView } from "./types";

function capture(angle: CapturedView["angle"]): CapturedView {
    const pixels = makePixels(640, 640, { r: 185, g: 145, b: 125 });
    addNoise(pixels, 25);
    return { angle, pixels, geometry: syntheticGeometry(angle) };
}

/** Synthetic label map: skin everywhere inside a central oval. */
function skinLabelMap(width: number, height: number): Uint8Array {
    const map = new Uint8Array(width * height);
    const cx = width / 2;
    const cy = height / 2;
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const dx = (x - cx) / (width * 0.35);
            const dy = (y - cy) / (height * 0.4);
            if (dx * dx + dy * dy <= 1) map[y * width + x] = PARSE.skin;
        }
    }
    return map;
}

describe("analyzeViewSync", () => {
    it("computes stats only for zones visible from the angle", () => {
        const front = analyzeViewSync(capture("front"));
        const profile = analyzeViewSync(capture("left-profile"));
        expect(Object.keys(front.zones).length).toBeGreaterThan(Object.keys(profile.zones).length);
        expect(profile.zones["right-cheek"]).toBeUndefined();
    });
    it("carries quality through", () => {
        const noFace = analyzeViewSync({ ...capture("front"), geometry: null });
        expect(noFace.quality.ok).toBe(false);
        expect(Object.keys(noFace.zones)).toHaveLength(0);
    });
});

describe("analyzeView", () => {
    it("uses parsing masks when label map is injected", async () => {
        const cap = capture("front");
        const sync = analyzeViewSync(cap);
        const parsed = await analyzeView(cap, { labelMap: skinLabelMap(cap.pixels.width, cap.pixels.height) });
        expect(parsed.maskSource).toBe("parsing");
        expect(parsed.maskQuality).toBeGreaterThan(0);
        // Parsed skin mask excludes hair/lips → typically fewer pixels than raw polygon.
        const syncPixels = Object.values(sync.zones).reduce((a, z) => a + z!.pixelCount, 0);
        const parsedPixels = Object.values(parsed.zones).reduce((a, z) => a + z!.pixelCount, 0);
        expect(parsedPixels).toBeLessThanOrEqual(syncPixels);
    });

    it("falls back to landmarks when parsing is skipped", async () => {
        const cap = capture("front");
        const view = await analyzeView(cap, { skipParsing: true });
        expect(view.maskSource).toBe("landmarks");
    });
});

describe("buildFaceReport", () => {
    it("assembles a contract-valid report from five captures", () => {
        const views = (["front", "left-45", "right-45", "left-profile", "right-profile"] as const).map(capture);
        const report = buildFaceReport(views.map(analyzeViewSync), { "face-landmarker": "dev" });
        const v = validateFaceReport(report);
        expect(v.ok).toBe(true);
        expect(report.pipelineVersion).toBe(PIPELINE_VERSION);
        expect(report.capture.angles).toHaveLength(5);
        expect(report.explanation).toBeNull();
    });
});
