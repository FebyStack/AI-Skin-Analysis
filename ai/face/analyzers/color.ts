// ai/face/analyzers/color.ts
// Color-family analyzers. Scores are normalized against named baselines — tunable constants.
import { zoneMeanDimension, clamp01, collectZones, type Analyzer } from "./types";

const REDNESS_BASELINE = 0.10;   // typical skin rednessIdx
const REDNESS_SPAN = 0.25;
export const rednessAnalyzer: Analyzer = (views) =>
  zoneMeanDimension(views, ["left-cheek", "right-cheek", "nose", "chin"],
    (s) => clamp01((s.rednessIdx - REDNESS_BASELINE) / REDNESS_SPAN + s.redSpotRatio * 2),
    "mean erythema index + red-spot density across cheeks/nose/chin");

const OIL_SPAN = 0.25;
export const oilinessAnalyzer: Analyzer = (views) =>
  zoneMeanDimension(views, ["forehead", "nose", "chin"],
    (s) => clamp01(s.brightSpotRatio / OIL_SPAN),
    "specular highlight ratio across the T-zone");

const PIGMENT_SPAN = 0.15;
export const pigmentationAnalyzer: Analyzer = (views) =>
  zoneMeanDimension(views, ["left-cheek", "right-cheek", "forehead"],
    (s) => clamp01(s.darkSpotRatio / PIGMENT_SPAN),
    "dark-spot density across cheeks/forehead");

const TONE_SPAN = 0.25;
export const toneConsistencyAnalyzer: Analyzer = (views) => {
  const collected = collectZones(views, ["forehead", "nose", "left-cheek", "right-cheek", "chin"]);
  if (collected.size < 2) return { score: 0, confidence: 0, perZone: [], evidence: "cross-zone luma spread (insufficient zones)" };
  const zoneLumas = [...collected.entries()].map(([zone, list]) => ({
    zone, luma: list.reduce((a, s) => a + s.meanLuma, 0) / list.length,
  }));
  const mean = zoneLumas.reduce((a, z) => a + z.luma, 0) / zoneLumas.length;
  const spread = Math.sqrt(zoneLumas.reduce((a, z) => a + (z.luma - mean) ** 2, 0) / zoneLumas.length);
  const score = clamp01(spread / TONE_SPAN);
  return {
    score,
    confidence: clamp01(collected.size / 5),
    perZone: zoneLumas.map((z) => ({ zone: z.zone, score: clamp01(Math.abs(z.luma - mean) / TONE_SPAN) })),
    evidence: "cross-zone luma spread (uneven tone)",
  };
};
