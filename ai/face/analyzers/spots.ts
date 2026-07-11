import { zoneMeanDimension, clamp01, collectZones, type Analyzer } from "./types";

export const acneAnalyzer: Analyzer = (views) =>
    zoneMeanDimension(views, ["left-cheek", "right-cheek", "forehead", "chin"],
        (s) => clamp01(s.redSpotRatio / 0.08),
        "inflamed (red-spot) cluster density across cheeks/forehead/chin");

export const underEyeAnalyzer: Analyzer = (views) => {
    const eyes = collectZones(views, ["under-eye"]);
    const cheeks = collectZones(views, ["left-cheek", "right-cheek"]);
    if (eyes.size === 0 || cheeks.size === 0)
        return { score: 0, confidence: 0, perZone: [], evidence: "under-eye vs cheek luma delta (zones not visible)" };
    const mean = (lists: typeof eyes) =>
        [...lists.values()].flat().reduce((a, s, _, arr) => a + s.meanLuma / arr.length, 0);
    const delta = mean(cheeks) - mean(eyes);         // darker under-eye → positive delta
    const score = clamp01(delta / 0.2);
    return {
        score, confidence: 1,
        perZone: [{ zone: "under-eye", score }],
        evidence: "under-eye darkness relative to cheek luma",
    };
};