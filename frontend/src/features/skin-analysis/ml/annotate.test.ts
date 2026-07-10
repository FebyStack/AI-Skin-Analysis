import { describe, it, expect } from "vitest";
import { pixelDistance } from "./annotate";

describe("pixelDistance", () => {
  it("is the euclidean distance between two points", () => {
    expect(pixelDistance({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
  });
});
