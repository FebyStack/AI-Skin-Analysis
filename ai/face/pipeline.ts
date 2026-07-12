import type { FaceReport } from "../../shared/face";
import { validateCapture } from "./quality/validate";
import { zonesVisibleFrom, maskForZone } from "./landmarks/zones";
import { zoneStats } from "./stats";
import { mergeViews } from "./merge/merge";
import { recommend, FACE_DISCLAIMER } from "./recommend/rules";
import { masksFromParsing, type LabelMap } from "./segmentation/masks";
import { parseFaceLabels } from "./segmentation/parser";
import type { AnalyzedView, CapturedView } from "./types";

export const PIPELINE_VERSION = 2;

const MIN_PARSED_PIXELS = 50;

export interface AnalyzeViewOptions {
    /** Inject a label map (tests) instead of running ONNX. */
    labelMap?: LabelMap | null;
    /** Skip ONNX even when available. */
    skipParsing?: boolean;
}

function buildZones(
    view: CapturedView,
    labelMap: LabelMap | null,
): Pick<AnalyzedView, "zones" | "maskSource" | "maskQuality"> {
    const zones: AnalyzedView["zones"] = {};
    if (!view.geometry) return { zones, maskSource: "landmarks", maskQuality: 0 };

    const visible = zonesVisibleFrom(view.angle);
    let parsedCount = 0;
    let usedParsing = false;

    if (labelMap) {
        const parsed = masksFromParsing(
            labelMap,
            view.geometry,
            view.pixels.width,
            view.pixels.height,
            visible,
        );
        for (const zone of visible) {
            const mask = parsed[zone]!;
            const stats = zoneStats(zone, view.pixels, mask);
            if (stats.pixelCount >= MIN_PARSED_PIXELS) {
                zones[zone] = stats;
                parsedCount++;
                usedParsing = true;
            }
        }
    }

    for (const zone of visible) {
        if (zones[zone]) continue;
        const mask = maskForZone(zone, view.geometry, view.pixels.width, view.pixels.height);
        zones[zone] = zoneStats(zone, view.pixels, mask);
    }

    return {
        zones,
        maskSource: usedParsing ? "parsing" : "landmarks",
        maskQuality: visible.length ? parsedCount / visible.length : 0,
    };
}

/** Sync path — landmark polygons only (tests / offline). */
export function analyzeViewSync(view: CapturedView): AnalyzedView {
    const quality = validateCapture(view.angle, view.pixels, view.geometry);
    const { zones, maskSource, maskQuality } = buildZones(view, null);
    return { angle: view.angle, quality, zones, maskSource, maskQuality };
}

/** Primary path — parsed skin masks when ONNX weights are present, else landmark fallback. */
export async function analyzeView(
    view: CapturedView,
    opts: AnalyzeViewOptions = {},
): Promise<AnalyzedView> {
    const quality = validateCapture(view.angle, view.pixels, view.geometry);
    let labelMap: LabelMap | null = null;
    if (view.geometry && !opts.skipParsing) {
        labelMap = opts.labelMap !== undefined ? opts.labelMap : await parseFaceLabels(view.pixels);
    }
    const { zones, maskSource, maskQuality } = buildZones(view, labelMap);
    return { angle: view.angle, quality, zones, maskSource, maskQuality };
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
