// shared/face.test.ts
import { goldenFaceReport } from "./testing/face-fixtures";
import { describe, it, expect } from "vitest";
import {
  FACE_ANGLES, FACE_DIMENSIONS, FACE_ANALYSIS_ZONES,
  validateFaceReport, markErrors, parseManualPoints, MAX_MARKS, type FindingMark,
} from "./face";

describe("face contract", () => {
  it("has 5 required angles and 11 dimensions", () => {
    expect(FACE_ANGLES).toHaveLength(5);
    expect(FACE_DIMENSIONS).toHaveLength(11);
    expect(FACE_ANALYSIS_ZONES).toContain("under-eye");
  });
  it("accepts the golden report", () => {
    expect(validateFaceReport(goldenFaceReport()).ok).toBe(true);
  });
  it("rejects a report missing a dimension", () => {
    const dims = { ...goldenFaceReport().dimensions } as Record<string, unknown>;
    delete dims["acne"];
    expect(validateFaceReport({ ...goldenFaceReport(), dimensions: dims }).ok).toBe(false);
  });
  it("rejects out-of-range scores", () => {
    const g = goldenFaceReport();
    g.overall.score = 1.5;
    expect(validateFaceReport(g).ok).toBe(false);
  });
});

const box = (over: Partial<FindingMark> = {}): FindingMark => ({
  kind: "acne", angle: "front", shape: { type: "box", x: 0.2, y: 0.3, w: 0.05, h: 0.05 },
  confidence: 0.8, source: "model", ...over,
});

describe("finding marks", () => {
  it("accepts reports without marks, with empty marks, and with valid marks", () => {
    expect(validateFaceReport(goldenFaceReport()).ok).toBe(true);
    expect(validateFaceReport({ ...goldenFaceReport(), marks: [] }).ok).toBe(true);
    expect(validateFaceReport({ ...goldenFaceReport(), marks: [box()] }).ok).toBe(true);
  });
  it("rejects boxes outside the image, unknown kinds and angles, bad confidence", () => {
    expect(markErrors([box({ shape: { type: "box", x: 0.98, y: 0.1, w: 0.05, h: 0.05 } })])).toHaveLength(1);
    expect(markErrors([box({ kind: "freckle" as never })])).toHaveLength(1);
    expect(markErrors([box({ angle: "back" as never })])).toHaveLength(1);
    expect(validateFaceReport({ ...goldenFaceReport(), marks: [box({ confidence: 2 })] }).ok).toBe(false);
  });
  it("caps the number of marks", () => {
    expect(markErrors(Array.from({ length: MAX_MARKS + 1 }, () => box()))).toEqual([`at most ${MAX_MARKS} marks`]);
  });
  it("parses staff points strictly", () => {
    expect(parseManualPoints([{ kind: "acne", x: 0.5, y: 0.5 }])).toEqual([{ kind: "acne", x: 0.5, y: 0.5 }]);
    expect(parseManualPoints([{ kind: "acne", x: 1.5, y: 0.5 }])).toBeNull();
    expect(parseManualPoints("x")).toBeNull();
  });
  it("caps polygon vertices at 256", () => {
    const okPolygon = Array.from({ length: 256 }, (_, i) => [i / 300, 0.1] as [number, number]);
    expect(markErrors([box({ shape: { type: "area", polygon: okPolygon } })])).toEqual([]);
    const tooMany = [...okPolygon, [0.99, 0.1] as [number, number]];
    expect(markErrors([box({ shape: { type: "area", polygon: tooMany } })])).toHaveLength(1);
  });
});

describe("markedAngles", () => {
  it("accepts a report where every mark's angle was examined", () => {
    const r = { ...goldenFaceReport(), marks: [box()], markedAngles: ["front"] as const };
    expect(validateFaceReport(r).ok).toBe(true);
  });
  it("rejects duplicate or unknown angles", () => {
    expect(validateFaceReport({ ...goldenFaceReport(), markedAngles: ["front", "front"] }).ok).toBe(false);
    expect(validateFaceReport({ ...goldenFaceReport(), markedAngles: ["back"] }).ok).toBe(false);
  });
  it("rejects a mark whose angle was not examined", () => {
    const r = { ...goldenFaceReport(), marks: [box({ angle: "left-45" })], markedAngles: ["front"] };
    expect(validateFaceReport(r).ok).toBe(false);
  });
  it("is absent-safe (older reports never set it)", () => {
    expect(validateFaceReport({ ...goldenFaceReport(), marks: [box()] }).ok).toBe(true);
  });
});
