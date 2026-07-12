import { describe, it, expect } from "vitest";
import { recommend, FACE_DISCLAIMER } from "./rules";
import { FACE_DIMENSIONS, type DimensionScore, type FaceDimension } from "../../../shared/face";

function dims(over: Partial<Record<FaceDimension, number>> = {}): Record<FaceDimension, DimensionScore> {
    return Object.fromEntries(
        FACE_DIMENSIONS.map((d) => [
            d,
            {
                score: over[d] ?? 0.1,
                confidence: 0.8,
                perZone: [],
                evidence: "test",
            },
        ]),
    ) as unknown as Record<FaceDimension, DimensionScore>;
}

describe("recommend", () => {
    it("always includes sunscreen and the disclaimer exists", () => {
        const r = recommend(dims());
        expect(r.skincare.join(" ")).toMatch(/sunscreen/i);
        expect(FACE_DISCLAIMER).toMatch(/not a (medical )?diagnosis/i);
    });
    it("high acne adds acne guidance + professional treatment suggestion", () => {
        const r = recommend(dims({ acne: 0.7 }));
        expect(r.skincare.join(" ")).toMatch(/salicylic|cleanser|non-comedogenic/i);
        expect(r.treatments.join(" ")).toMatch(/dermatolog|professional/i);
    });
    it("high dryness adds moisturizer guidance", () => {
        expect(recommend(dims({ dryness: 0.7 })).skincare.join(" ")).toMatch(/moisturi|hydrat/i);
    });
    it("calm skin yields no treatment escalations", () => {
        expect(recommend(dims()).treatments).toEqual([]);
    });
    it("never emits prescription language", () => {
        const all = recommend(dims({ acne: 0.9, wrinkles: 0.9, pigmentation: 0.9 }));
        expect([...all.skincare, ...all.treatments].join(" ")).not.toMatch(/\b(tretinoin|isotretinoin|hydroquinone|dosage|mg)\b/i);
    });
});