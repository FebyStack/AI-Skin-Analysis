import { describe, it, expect } from "vitest";
import { reportFromPixels } from "./use-quality-gate";

function grayField(value: number, px: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(px * 4);
  for (let i = 0; i < px; i++) {
    out[i * 4] = value;
    out[i * 4 + 1] = value;
    out[i * 4 + 2] = value;
    out[i * 4 + 3] = 255;
  }
  return out;
}

describe("reportFromPixels", () => {
  it("fails a dark, flat image", () => {
    const r = reportFromPixels(grayField(5, 16), 4, 4, true);
    expect(r.ok).toBe(false);
    expect(r.issues).toContain("too-dark");
  });

  it("passes a mid-tone image with texture and a region", () => {
    const px = new Uint8ClampedArray(4 * 4 * 4);
    for (let i = 0; i < 16; i++) {
      const v = i % 2 === 0 ? 40 : 210; // alternating → sharpness
      px[i * 4] = v;
      px[i * 4 + 1] = v;
      px[i * 4 + 2] = v;
      px[i * 4 + 3] = 255;
    }
    const r = reportFromPixels(px, 4, 4, true);
    expect(r.regionFound).toBe(true);
    expect(r.issues).not.toContain("too-dark");
    expect(r.issues).not.toContain("blur");
  });

  it("flags a missing region regardless of exposure", () => {
    const r = reportFromPixels(grayField(128, 16), 4, 4, false);
    expect(r.issues).toContain("no-region");
  });
});
