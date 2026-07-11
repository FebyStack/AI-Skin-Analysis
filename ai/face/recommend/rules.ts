import type { DimensionScore, FaceDimension } from "../../../shared/face";

export const FACE_DISCLAIMER =
    "This is an automated cosmetic skin assessment, not a medical diagnosis. " +
    "For any concern about a specific spot, mole, or persistent condition, consult a qualified professional.";

const HIGH = 0.5;

interface Rule { dim: FaceDimension; skincare: string; treatment?: string }

const RULES: Rule[] = [
    { dim: "acne", skincare: "Use a gentle non-comedogenic cleanser; consider over-the-counter salicylic-acid products.", treatment: "Persistent or inflamed breakouts are worth a dermatologist visit." },
    { dim: "pigmentation", skincare: "Daily broad-spectrum sunscreen is the single best step against dark spots.", treatment: "A professional can advise on brightening treatments if spots bother you." },
    { dim: "redness", skincare: "Prefer fragrance-free products and avoid hot water on the face.", treatment: "Persistent facial redness can be assessed professionally." },
    { dim: "texture", skincare: "Gentle exfoliation once or twice a week can smooth surface texture." },
    { dim: "pores", skincare: "Consistent cleansing and oil control help pore visibility." },
    { dim: "oiliness", skincare: "Use a lightweight, oil-free moisturizer and blotting rather than over-washing." },
    { dim: "dryness", skincare: "Layer a richer moisturizer on damp skin; consider a humidifier in dry rooms." },
    { dim: "fine-lines", skincare: "Hydration plus daily sunscreen slows fine-line progression." },
    { dim: "wrinkles", skincare: "Sun protection and a consistent moisturizing routine matter most.", treatment: "A professional can outline options if wrinkle depth concerns you." },
    { dim: "under-eye", skincare: "Sleep, hydration, and a caffeine-based eye product can reduce under-eye darkness." },
    { dim: "tone-consistency", skincare: "Even application of sunscreen helps tone evenness over time." },
];

export function recommend(dimensions: Record<FaceDimension, DimensionScore>): { skincare: string[]; treatments: string[] } {
    const skincare = ["Daily broad-spectrum sunscreen."];
    const treatments: string[] = [];
    for (const rule of RULES) {
        if (dimensions[rule.dim].score >= HIGH) {
            skincare.push(rule.skincare);
            if (rule.treatment) treatments.push(rule.treatment);
        }
    }
    return { skincare: [...new Set(skincare)], treatments };
}