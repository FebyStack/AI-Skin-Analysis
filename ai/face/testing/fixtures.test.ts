// ai/face/testing/fixtures.test.ts
import { describe, it, expect } from "vitest";
import { makePixels, paintRect, syntheticGeometry } from "./fixtures";

describe("fixtures", () => {
  it("makePixels fills RGBA", () => {
    const px = makePixels(10, 10, { r: 200, g: 150, b: 120 });
    expect(px.data.length).toBe(400);
    expect(px.data[0]).toBe(200);
    expect(px.data[3]).toBe(255);
  });
  it("paintRect overwrites a region", () => {
    const px = makePixels(10, 10, { r: 0, g: 0, b: 0 });
    paintRect(px, { x: 2, y: 2, w: 3, h: 3 }, { r: 255, g: 0, b: 0 });
    const idx = (3 * 10 + 3) * 4;
    expect(px.data[idx]).toBe(255);
  });
  it("syntheticGeometry yields 478 landmarks with a frontal pose", () => {
    const g = syntheticGeometry("front");
    expect(g.landmarks).toHaveLength(478);
    expect(Math.abs(g.yawDeg)).toBeLessThan(5);
    expect(syntheticGeometry("left-45").yawDeg).toBeLessThan(-30);
  });
});
