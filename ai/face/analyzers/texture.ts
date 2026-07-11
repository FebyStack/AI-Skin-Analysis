import { zoneMeanDimension, clamp01, type Analyzer } from "./types";

const HF_BASE = 0.008;   // smooth-skin high-frequency floor
const HF_SPAN = 0.05;

export const textureAnalyzer: Analyzer = (views) =>
    zoneMeanDimension(views, ["left-cheek", "right-cheek", "forehead", "chin"],
        (s) => clamp01((s.highFreqRatio - HF_BASE) / HF_SPAN),
        "surface high-frequency energy (relief) across cheeks/forehead/chin");

export const poresAnalyzer: Analyzer = (views) =>
    zoneMeanDimension(views, ["nose", "left-cheek", "right-cheek"],
        (s) => clamp01((s.highFreqRatio - HF_BASE) / HF_SPAN * 0.7 + s.darkSpotRatio * 4 * 0.3),
        "micro-contrast + dark-pit density on nose/cheeks");

export const fineLinesAnalyzer: Analyzer = (views) =>
    zoneMeanDimension(views, ["periorbital", "under-eye"],
        (s) => clamp01((s.highFreqRatio - HF_BASE) / HF_SPAN),
        "micro-texture in periorbital/under-eye zones");

export const wrinklesAnalyzer: Analyzer = (views) =>
    zoneMeanDimension(views, ["forehead", "periorbital"],
        (s) => clamp01(((s.highFreqRatio - HF_BASE) / HF_SPAN) * 0.6 + (s.lumaStd / 0.2) * 0.4),
        "deep-relief contrast (high-frequency + shadow spread) on forehead/periorbital");

export const drynessAnalyzer: Analyzer = (views) =>
    zoneMeanDimension(views, ["left-cheek", "right-cheek", "chin"],
        (s) => clamp01(((s.highFreqRatio - HF_BASE) / HF_SPAN) * (1 - clamp01(s.brightSpotRatio / 0.1))),
        "flaky micro-texture in the absence of specular shine (visual dryness proxy)");