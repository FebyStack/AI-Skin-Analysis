import { describe, it, expect } from "vitest";
import { reportFromPixels } from "./use-quality-gate";

function field(value: number, width: number, height: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    out[i * 4] = value;
    out[i * 4 + 1] = value;
    out[i * 4 + 2] = value;
    out[i * 4 + 3] = 255;
  }
  return out;
}

describe("reportFromPixels", () => {
  it("fails a dark, flat image", () => {
    const r = reportFromPixels(field(5, 320, 320), 320, 320, true);
    expect(r.ok).toBe(false);
    expect(r.issues).toContain("too-dark");
  });

  it("passes a mid-tone image with texture and a region", () => {
    const width = 320;
    const height = 320;
    const px = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < width * height; i++) {
      const v = i % 2 === 0 ? 198 : 214;
      px[i * 4] = v;
      px[i * 4 + 1] = Math.max(0, v - 24);
      px[i * 4 + 2] = Math.max(0, v - 40);
      px[i * 4 + 3] = 255;
    }
    const r = reportFromPixels(px, width, height, true, width, height);
    expect(r.regionFound).toBe(true);
    expect(r.issues).not.toContain("too-dark");
    expect(r.issues).not.toContain("blur");
    expect(r.issues).not.toContain("low-resolution");
    expect(r.guidance).toBe("");
  });

  it("flags a missing region regardless of exposure", () => {
    const r = reportFromPixels(field(128, 320, 320), 320, 320, false);
    expect(r.issues).toContain("no-region");
  });

  it("flags low resolution and bad aspect ratio", () => {
    const px = field(140, 120, 80);
    const r = reportFromPixels(px, 120, 80, true, 120, 80);
    expect(r.issues).toContain("low-resolution");
    expect(r.issues).toContain("unsupported-aspect-ratio");
  });
});
