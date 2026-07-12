import { FACE_DIMENSIONS, type DimensionScore, type FaceDimension } from "../../../shared/face";
import { ANALYZERS } from "../analyzers/index";
import { clamp01 } from "../analyzers/types";
import type { AnalyzedView } from "../types";

export const REQUIRED_ANGLE_COUNT = 5;

// Versioned, visible weighting — never hidden. score semantics: higher = more pronounced issue.
export const OVERALL_WEIGHTS: Record<FaceDimension, number> = {
    acne: 0.14, pigmentation: 0.1, redness: 0.1, texture: 0.09, pores: 0.07,
    oiliness: 0.08, dryness: 0.08, "fine-lines": 0.09, wrinkles: 0.1,
    "under-eye": 0.07, "tone-consistency": 0.08,
};

export interface MergedAnalysis {
    dimensions: Record<FaceDimension, DimensionScore>;
    overall: { score: number; confidence: number };
}

export function mergeViews(views: AnalyzedView[]): MergedAnalysis {
    const usable = views.filter((v) => v.quality.ok);
    const captureCoverage = clamp01(usable.length / REQUIRED_ANGLE_COUNT);
    const parsingBoost = parsingConfidenceBoost(usable);

    const dimensions = Object.fromEntries(
        FACE_DIMENSIONS.map((d) => {
            const raw = ANALYZERS[d](usable);
            return [d, {
                ...raw,
                confidence: clamp01(raw.confidence * (0.5 + 0.5 * captureCoverage) * parsingBoost),
            }];
        }),
    ) as Record<FaceDimension, DimensionScore>;

    const overallScore = clamp01(
        FACE_DIMENSIONS.reduce((a, d) => a + dimensions[d].score * OVERALL_WEIGHTS[d], 0),
    );
    const overallConfidence = clamp01(
        FACE_DIMENSIONS.reduce((a, d) => a + dimensions[d].confidence, 0) / FACE_DIMENSIONS.length,
    );
    return { dimensions, overall: { score: overallScore, confidence: overallConfidence } };
}

/** Up to +15% confidence when parsed skin masks drive zone stats. */
export function parsingConfidenceBoost(views: AnalyzedView[]): number {
    if (views.length === 0) return 1;
    const parsed = views.filter((v) => v.maskSource === "parsing");
    if (parsed.length === 0) return 1;
    const avgQuality = parsed.reduce((a, v) => a + (v.maskQuality ?? 0), 0) / parsed.length;
    const coverage = parsed.length / views.length;
    return 1 + 0.15 * coverage * avgQuality;
}