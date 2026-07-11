import type { FaceReport } from "../../shared/face";
import { validateCapture } from "./quality/validate";
import { zonesVisibleFrom, maskForZone } from "./landmarks/zones";
import { zoneStats } from "./stats";
import { mergeViews } from "./merge/merge";
import { recommend, FACE_DISCLAIMER } from "./recommend/rules";
import type { AnalyzedView, CapturedView } from "./types";

export const PIPELINE_VERSION = 1;

export function analyzeView(view: CapturedView): AnalyzedView {
    const quality = validateCapture(view.angle, view.pixels, view.geometry);
    const zones: AnalyzedView["zones"] = {};
    if (view.geometry) {
        for (const zone of zonesVisibleFrom(view.angle)) {
            const mask = maskForZone(zone, view.geometry, view.pixels.width, view.pixels.height);
            zones[zone] = zoneStats(zone, view.pixels, mask);
        }
    }
    return { angle: view.angle, quality, zones };
}

export function buildFaceReport(
    views: AnalyzedView[],
    modelVersions: Record<string, string>,
): FaceReport {
    const { dimensions, overall } = mergeViews(views);
    return {
        kind: "face-v2",
        overall,
        dimensions,
        capture: { angles: views.map((v) => ({ angle: v.angle, quality: v.quality })) },
        recommendations: recommend(dimensions),
        explanation: null,      // Phase C fills gemini/builtin
        disclaimer: FACE_DISCLAIMER,
        pipelineVersion: PIPELINE_VERSION,
        modelVersions,
    };
}