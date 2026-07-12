// ai/face/quality/validate.test.ts
import { describe, it, expect } from "vitest";
import { validateCapture, ANGLE_YAW_WINDOWS } from "./validate";
import { makePixels, addNoise, syntheticGeometry } from "../testing/fixtures";

const goodPixels = () => { const p = makePixels(640, 640, { r: 185, g: 145, b: 125 }); addNoise(p, 25); return p; };

describe("validateCapture", () => {
  it("passes a good frontal capture", () => {
    const q = validateCapture("front", goodPixels(), syntheticGeometry("front"));
    expect(q.ok).toBe(true);
    expect(q.issues).toEqual([]);
  });
  it("no face detected", () => {
    const q = validateCapture("front", goodPixels(), null);
    expect(q.ok).toBe(false);
    expect(q.issues).toContain("no-face");
  });
  it("wrong orientation for the requested angle", () => {
    const q = validateCapture("left-45", goodPixels(), syntheticGeometry("front"));
    expect(q.issues).toContain("wrong-orientation");
  });
  it("too dark", () => {
    const dark = makePixels(640, 640, { r: 20, g: 15, b: 12 });
    const q = validateCapture("front", dark, syntheticGeometry("front"));
    expect(q.issues).toContain("too-dark");
  });
  it("blur (no high-frequency detail)", () => {
    const flat = makePixels(640, 640, { r: 185, g: 145, b: 125 }); // zero texture = blur proxy
    const q = validateCapture("front", flat, syntheticGeometry("front"));
    expect(q.issues).toContain("blur");
  });
  it("face too small in frame", () => {
    const q = validateCapture("front", goodPixels(), syntheticGeometry("front", 0.5, 0.5, 0.08));
    expect(q.issues).toContain("face-too-small");
  });
  it("low resolution", () => {
    const tiny = makePixels(200, 200, { r: 185, g: 145, b: 125 });
    addNoise(tiny, 25);
    const q = validateCapture("front", tiny, syntheticGeometry("front"));
    expect(q.issues).toContain("low-resolution");
  });
  it("yaw windows cover all five angles", () => {
    expect(Object.keys(ANGLE_YAW_WINDOWS)).toHaveLength(5);
  });
});
