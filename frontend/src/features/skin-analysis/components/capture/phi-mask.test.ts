import { describe, it, expect } from "vitest";
import { GUIDE, OUTER, maskSegments, orthoFraming, outerPathD, svgGuide } from "./phi-mask";

describe("phi mask geometry", () => {
  it("is left-right symmetric", () => {
    // Every x has a partner at -x once centred, or sits on the axis.
    const xs = OUTER.map(([x]) => x);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
    for (const [x, y] of OUTER) {
      const mirrored = OUTER.some(
        ([mx, my]) => Math.abs(mx - (2 * cx - x)) < 1e-6 && Math.abs(my - y) < 1e-6,
      );
      expect(mirrored, `no mirror for (${x},${y})`).toBe(true);
    }
  });

  it("has no duplicate vertices in the closed silhouette", () => {
    const seen = new Set(OUTER.map(([x, y]) => `${x},${y}`));
    expect(seen.size).toBe(OUTER.length);
  });

  it("emits whole line segments — pairs of xyz vertices", () => {
    const seg = maskSegments();
    expect(seg.length % 6).toBe(0); // 2 vertices × 3 components
    expect(seg.length).toBeGreaterThan(0);
    expect([...seg].every(Number.isFinite)).toBe(true);
  });

  it("gives the mask depth so a turn reads as a head, not a squashed decal", () => {
    const seg = maskSegments();
    const zs = [...seg].filter((_, i) => i % 3 === 2);
    expect(Math.max(...zs)).toBeGreaterThan(0.2);
  });

  it("frames the SVG and WebGL layers identically", () => {
    const { scale, cy } = svgGuide(100, 133);
    const { halfHeight, offsetY } = orthoFraming();
    // Mask occupies the same fraction of frame height in both layers.
    expect((scale * 2) / 133).toBeCloseTo(GUIDE.heightFraction, 6);
    expect(1 / halfHeight).toBeCloseTo(GUIDE.heightFraction, 6);
    // ...and sits at the same height: both offsets agree on centreY.
    expect(cy / 133).toBeCloseTo(GUIDE.centerY, 6);
    expect((halfHeight - offsetY) / (2 * halfHeight)).toBeCloseTo(GUIDE.centerY, 6);
  });

  it("draws a closed path that stays inside the viewBox", () => {
    const { cx, cy, scale } = svgGuide(100, 133);
    const d = outerPathD(cx, cy, scale);
    expect(d.startsWith("M")).toBe(true);
    expect(d.endsWith("Z")).toBe(true);
    for (const n of d.match(/-?\d+\.\d+/g) ?? []) {
      expect(Number(n)).toBeGreaterThanOrEqual(0);
      expect(Number(n)).toBeLessThanOrEqual(133);
    }
  });
});
