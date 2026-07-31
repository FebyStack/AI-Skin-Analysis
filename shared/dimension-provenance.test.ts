import { describe, it, expect } from "vitest";
import { FACE_DIMENSIONS, MODELLED_DIMENSIONS, isModelled } from "./face";
import { zoneMeanDimension } from "../ai/face/analyzers/types";

describe("dimension provenance", () => {
  it("marks every deterministic analyzer as a heuristic", () => {
    // One fully-visible zone set: coverage is 1.0, which is exactly the case
    // that used to render as a green "100%" confidence badge.
    // `zones` is a plain record and a zone only counts when pixelCount > 0.
    const views = [
      {
        zones: {
          forehead: {
            pixelCount: 500,
            highFreqRatio: 0.01,
            lumaStd: 0.05,
            lumaMean: 0.5,
            darkSpotRatio: 0,
            brightSpotRatio: 0,
          },
        },
      },
    ] as never;
    const r = zoneMeanDimension(views, ["forehead"], () => 0.1, "test metric");
    expect(r.confidence).toBe(1);
    // The number is 1.0, but it means "saw every zone" — never "certain".
    expect(r.source).toBe("heuristic");
  });

  it("does not claim a model for dimensions that have none", () => {
    const unmodelled = FACE_DIMENSIONS.filter((d) => !isModelled(d));
    // Guards against quietly re-adding a dimension to the report and implying
    // it is measured. If a real model ships, add it to MODELLED_DIMENSIONS.
    expect(unmodelled).toContain("wrinkles");
    expect(unmodelled).toContain("fine-lines");
    expect(unmodelled).toContain("redness");
    expect(MODELLED_DIMENSIONS).toEqual(["acne"]);
  });

  it("treats a report saved before provenance existed as heuristic", () => {
    expect(isModelled("wrinkles", { score: 0, confidence: 1, perZone: [], evidence: "old" })).toBe(false);
  });
});
