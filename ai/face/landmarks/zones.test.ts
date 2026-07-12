// ai/face/landmarks/zones.test.ts
import { describe, it, expect } from "vitest";
import { zonesVisibleFrom, zonePolygon, maskForZone } from "./zones";
import { syntheticGeometry, makePixels } from "../testing/fixtures";

describe("zones", () => {
  it("front view sees all zones; profiles see one side", () => {
    expect(zonesVisibleFrom("front")).toContain("left-cheek");
    expect(zonesVisibleFrom("front")).toContain("right-cheek");
    expect(zonesVisibleFrom("left-profile")).toContain("left-cheek");
    expect(zonesVisibleFrom("left-profile")).not.toContain("right-cheek");
  });
  it("zonePolygon returns ≥3 points within image bounds", () => {
    const g = syntheticGeometry("front");
    for (const zone of zonesVisibleFrom("front")) {
      const poly = zonePolygon(zone, g);
      expect(poly.length).toBeGreaterThanOrEqual(3);
      for (const p of poly) {
        expect(p.x).toBeGreaterThanOrEqual(0); expect(p.x).toBeLessThanOrEqual(1);
        expect(p.y).toBeGreaterThanOrEqual(0); expect(p.y).toBeLessThanOrEqual(1);
      }
    }
  });
  it("maskForZone marks interior pixels", () => {
    const g = syntheticGeometry("front");
    const px = makePixels(100, 100, { r: 0, g: 0, b: 0 });
    const mask = maskForZone("forehead", g, px.width, px.height);
    const inside = mask.reduce((n, b) => n + b, 0);
    expect(inside).toBeGreaterThan(20);          // nontrivial region
    expect(inside).toBeLessThan(100 * 100 * 0.6); // not the whole image
  });
});
