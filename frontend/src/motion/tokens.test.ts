import { describe, it, expect } from "vitest";
import { STAGGER_BUDGET, severityOf, staggerFor } from "./tokens";

describe("motion tokens", () => {
  it("maps a score to its severity band", () => {
    expect(severityOf(0.05)).toBe("ok");
    expect(severityOf(0.3)).toBe("routine");
    expect(severityOf(0.5)).toBe("soon");
    expect(severityOf(0.9)).toBe("urgent");
  });

  it("keeps a long cascade inside the 500ms stagger budget", () => {
    for (const n of [1, 2, 6, 40]) {
      expect(staggerFor(n) * (n - 1)).toBeLessThanOrEqual(STAGGER_BUDGET);
    }
  });

  it("does not stagger a single element", () => {
    expect(staggerFor(1)).toBe(0);
  });
});
