import { describe, it, expect } from "vitest";
import { PARSE } from "./labels";
import { argmaxLogits, upscaleLabelMap, zoneMaskFromParsing } from "./masks";
import { makePixels, syntheticGeometry } from "../testing/fixtures";

describe("argmaxLogits", () => {
    it("picks the highest class per pixel", () => {
        // 2 classes, 2×2 spatial
        const logits = new Float32Array([
            0, 0, 0, 0,   // class 0
            1, 1, 1, 1,   // class 1 wins everywhere
        ]);
        const labels = argmaxLogits(logits, 2, 2, 2);
        expect([...labels]).toEqual([1, 1, 1, 1]);
    });
});

describe("upscaleLabelMap", () => {
    it("nearest-neighbour upsamples to target resolution", () => {
        const small = new Uint8Array([PARSE.skin, PARSE.hair, PARSE.skin, PARSE.hair]);
        const up = upscaleLabelMap(small, 2, 2, 4, 4);
        expect(up[0]).toBe(PARSE.skin);
        expect(up[3]).toBe(PARSE.hair);
    });
});

describe("zoneMaskFromParsing", () => {
    it("keeps skin inside landmark polygon and drops hair", () => {
        const w = 64;
        const h = 64;
        const pixels = makePixels(w, h, { r: 200, g: 160, b: 140 });
        const geometry = syntheticGeometry("front");
        const labelMap = new Uint8Array(w * h).fill(PARSE.hair);
        // Paint skin in cheek region (rough centre-left)
        for (let y = 20; y < 45; y++) {
            for (let x = 10; x < 30; x++) labelMap[y * w + x] = PARSE.skin;
        }
        const mask = zoneMaskFromParsing("left-cheek", labelMap, geometry, w, h);
        let on = 0;
        for (let p = 0; p < mask.length; p++) if (mask[p]) on++;
        expect(on).toBeGreaterThan(0);
        // Hair-only pixels inside polygon must not appear in mask
        for (let p = 0; p < mask.length; p++) {
            if (mask[p]) expect(labelMap[p]).toBe(PARSE.skin);
        }
        void pixels;
    });
});
