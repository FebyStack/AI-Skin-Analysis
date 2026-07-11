import type { FaceDimension } from "../../../shared/face";
import type { Analyzer } from "./types";
import { rednessAnalyzer, oilinessAnalyzer, pigmentationAnalyzer, toneConsistencyAnalyzer } from "./color";
import { textureAnalyzer, poresAnalyzer, fineLinesAnalyzer, wrinklesAnalyzer, drynessAnalyzer } from "./texture";
import { acneAnalyzer, underEyeAnalyzer } from "./spots";

// D1 seam: swap any single entry for a learned model without touching the others.
export const ANALYZERS: Record<FaceDimension, Analyzer> = {
    acne: acneAnalyzer,
    pigmentation: pigmentationAnalyzer,
    redness: rednessAnalyzer,
    texture: textureAnalyzer,
    pores: poresAnalyzer,
    oiliness: oilinessAnalyzer,
    dryness: drynessAnalyzer,
    "fine-lines": fineLinesAnalyzer,
    wrinkles: wrinklesAnalyzer,
    "under-eye": underEyeAnalyzer,
    "tone-consistency": toneConsistencyAnalyzer,
};