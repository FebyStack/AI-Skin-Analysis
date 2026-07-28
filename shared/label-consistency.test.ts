import { describe, it, expect } from "vitest";
import { checkConsistency } from "./label-consistency";

const at = (days: number) => Date.now() - days * 86_400_000;

describe("label consistency", () => {
  it("flags a large acne swing two days apart (the reported case)", () => {
    const w = checkConsistency({
      previous: { acne: "moderate" },
      current: { acne: "clear" },
      previousAt: at(2),
      currentAt: at(0),
    });
    expect(w).toHaveLength(1);
    expect(w[0]).toMatchObject({ field: "acne", previous: "moderate", current: "clear", daysApart: 2 });
    expect(w[0].reason).toMatch(/short period/i);
  });

  it("stays quiet when the change is gradual", () => {
    expect(checkConsistency({
      previous: { acne: "moderate" }, current: { acne: "mild" },
      previousAt: at(2), currentAt: at(0),
    })).toHaveLength(0);
  });

  it("stays quiet when the visits are far apart — skin really can change", () => {
    expect(checkConsistency({
      previous: { acne: "moderate" }, current: { acne: "clear" },
      previousAt: at(120), currentAt: at(0),
    })).toHaveLength(0);
  });

  it("ignores skin type — it's categorical, so oily→dry isn't a 'jump'", () => {
    expect(checkConsistency({
      previous: { skintype: "oily" }, current: { skintype: "dry" },
      previousAt: at(1), currentAt: at(0),
    })).toHaveLength(0);
  });

  it("flags the 4-level severity dimensions too", () => {
    const w = checkConsistency({
      previous: { redness: "severe" }, current: { redness: "none" },
      previousAt: at(1), currentAt: at(0),
    });
    expect(w[0]).toMatchObject({ field: "redness", levelJump: 3 });
    expect(w[0].reason).toMatch(/same day|short period/i);
  });
});
