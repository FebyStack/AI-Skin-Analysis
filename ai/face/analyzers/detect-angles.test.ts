import { describe, it, expect, vi } from "vitest";
import { detectAngles, MAX_MARKS_PER_ANGLE } from "./detect-angles";
import type { DetectorInput, DetectionResult } from "./acne-detector";
import type { FaceAngle, FindingMark } from "../../../shared/face";

const detectorInput = (angle: FaceAngle): DetectorInput => ({
  angle,
  crop: { data: new Uint8ClampedArray(4), width: 1, height: 1 },
  rect: { x: 0, y: 0, w: 10, h: 10 },
  frame: { w: 100, h: 100 },
});

const mark = (angle: FaceAngle, confidence: number, over: Partial<FindingMark> = {}): FindingMark => ({
  kind: "acne",
  angle,
  confidence,
  source: "model",
  shape: { type: "box", x: 0.1, y: 0.1, w: 0.05, h: 0.05 },
  ...over,
});

const source = (angle: FaceAngle, crop: () => Promise<DetectorInput | null>) => ({ angle, crop });

const FAR_FUTURE = Date.now() + 1_000_000;

describe("detectAngles", () => {
  it("returns null when the detector is absent", async () => {
    const detect = vi.fn(async (): Promise<DetectionResult | null> => null);
    const result = await detectAngles([source("front", async () => detectorInput("front"))], detect, FAR_FUTURE);
    expect(result).toBeNull();
  });

  it("returns null when no angle was examined (every crop failed)", async () => {
    const detect = vi.fn(async (): Promise<DetectionResult | null> => ({ marks: [], examined: [] }));
    const result = await detectAngles(
      [source("front", async () => null), source("left-45", async () => null)],
      detect,
      FAR_FUTURE,
    );
    expect(result).toBeNull();
    expect(detect).not.toHaveBeenCalled();
  });

  it("excludes an angle whose crop failed from examined, but still runs the rest", async () => {
    const detect = vi.fn(async (inputs: DetectorInput[]): Promise<DetectionResult> => ({
      marks: [mark(inputs[0].angle, 0.9)],
      examined: [inputs[0].angle],
    }));
    const result = await detectAngles(
      [source("front", async () => null), source("left-45", async () => detectorInput("left-45"))],
      detect,
      FAR_FUTURE,
    );
    expect(result?.examined).toEqual(["left-45"]);
  });

  it("excludes an angle whose detection run failed from examined", async () => {
    const detect = vi.fn(async (inputs: DetectorInput[]): Promise<DetectionResult> =>
      inputs[0].angle === "front"
        ? { marks: [], examined: [] } // simulates session.run throwing for this view
        : { marks: [mark("left-45", 0.9)], examined: ["left-45"] },
    );
    const result = await detectAngles(
      [source("front", async () => detectorInput("front")), source("left-45", async () => detectorInput("left-45"))],
      detect,
      FAR_FUTURE,
    );
    expect(result?.examined).toEqual(["left-45"]);
    expect(result?.marks).toEqual([mark("left-45", 0.9)]);
  });

  it("drops marks with any non-finite number", async () => {
    const detect = vi.fn(async (): Promise<DetectionResult> => ({
      marks: [
        mark("front", 0.9, { shape: { type: "box", x: NaN, y: 0.1, w: 0.05, h: 0.05 } }),
        mark("front", 0.8, { confidence: Infinity }),
        mark("front", 0.7),
      ],
      examined: ["front"],
    }));
    const result = await detectAngles([source("front", async () => detectorInput("front"))], detect, FAR_FUTURE);
    expect(result?.marks).toEqual([mark("front", 0.7)]);
  });

  it("caps marks per angle at MAX_MARKS_PER_ANGLE, highest confidence first", async () => {
    const total = MAX_MARKS_PER_ANGLE + 20;
    const many = Array.from({ length: total }, (_, i) => mark("front", i / total));
    const detect = vi.fn(async (): Promise<DetectionResult> => ({ marks: many, examined: ["front"] }));
    const result = await detectAngles([source("front", async () => detectorInput("front"))], detect, FAR_FUTURE);
    expect(result?.marks).toHaveLength(MAX_MARKS_PER_ANGLE);
    // The 20 lowest-confidence marks (i < 20) were dropped.
    expect(result?.marks.every((m) => m.confidence >= 20 / total)).toBe(true);
  });

  it("returns null when a sanitised mark still fails the report contract (out-of-bounds box)", async () => {
    // Finite, but x + w > 1 — validBox in shared/face.ts rejects it. A backstop
    // for a rowsToMarks bug, not a path real detections take today.
    const detect = vi.fn(async (): Promise<DetectionResult> => ({
      marks: [mark("front", 0.9, { shape: { type: "box", x: 0.9, y: 0.1, w: 0.5, h: 0.05 } })],
      examined: ["front"],
    }));
    const result = await detectAngles([source("front", async () => detectorInput("front"))], detect, FAR_FUTURE);
    expect(result).toBeNull();
  });

  it("stops at the deadline and never crops the next angle", async () => {
    let calls = 0;
    const now = () => (calls++ === 0 ? 0 : 1000); // late by the second check
    const crop2 = vi.fn(async () => detectorInput("left-45"));
    const detect = vi.fn(async (): Promise<DetectionResult> => ({ marks: [], examined: ["front"] }));
    const result = await detectAngles(
      [source("front", async () => detectorInput("front")), source("left-45", crop2)],
      detect,
      500,
      now,
    );
    expect(crop2).not.toHaveBeenCalled();
    expect(result?.examined).toEqual(["front"]);
  });
});
