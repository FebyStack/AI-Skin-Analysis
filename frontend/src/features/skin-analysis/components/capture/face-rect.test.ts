import { describe, it, expect } from "vitest";
import { faceRect } from "./face-rect";

describe("faceRect", () => {
  it("adds a 15% margin around the landmarks and clamps to the frame", () => {
    const g = { landmarks: [{ x: 0.4, y: 0.3, z: 0 }, { x: 0.6, y: 0.7, z: 0 }], yawDeg: 0, pitchDeg: 0, rollDeg: 0 };
    const r = faceRect(g, 1000, 1000);
    expect(r.x).toBe(370);
    expect(r.y).toBe(240);
    expect(Math.abs(r.w - 260)).toBeLessThanOrEqual(1);
    expect(Math.abs(r.h - 520)).toBeLessThanOrEqual(1);
    const edge = faceRect({ ...g, landmarks: [{ x: 0, y: 0, z: 0 }, { x: 1, y: 1, z: 0 }] }, 100, 100);
    expect(edge).toEqual({ x: 0, y: 0, w: 100, h: 100 });
  });
});
