import { describe, it, expect, vi, afterEach } from "vitest";
import { letterbox, shadesOfGrey, toTensorData, rowsToMarks, detectAcne, type DetectorInput } from "./acne-detector";

const tiny = { data: new Uint8ClampedArray(4), width: 1, height: 1 };

describe("detectAcne without a shipped model", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("returns null (detector absent) rather than an empty result", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    expect(await detectAcne([])).toBeNull();
  });
  it("retries the probe on a later call instead of caching the failure forever", async () => {
    const fetchMock = vi.fn(async () => { throw new Error("offline"); });
    vi.stubGlobal("fetch", fetchMock);
    expect(await detectAcne([])).toBeNull();
    expect(await detectAcne([])).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("acne detector geometry", () => {
  it("letterboxes like ultralytics", () => {
    expect(letterbox(400, 500)).toEqual({ scale: 1.28, padX: 64, padY: 0 });
  });

  it("maps a 640-space box back to normalised full-frame coordinates", () => {
    const input: DetectorInput = { angle: "front", crop: tiny, rect: { x: 100, y: 50, w: 400, h: 500 }, frame: { w: 1280, h: 720 } };
    const [m] = rowsToMarks(new Float32Array([192, 64, 320, 192, 0.9, 0, 0, 0, 0, 0, 0, 0]), input, letterbox(400, 500), 0.35);
    const b = m.shape as { x: number; y: number; w: number; h: number };
    expect(m).toMatchObject({ kind: "acne", angle: "front", source: "model" });
    expect(b.x).toBeCloseTo(200 / 1280);
    expect(b.y).toBeCloseTo(100 / 720);
    expect(b.w).toBeCloseTo(100 / 1280);
    expect(b.h).toBeCloseTo(100 / 720);
  });

  it("drops zero-padded rows and low scores", () => {
    const input: DetectorInput = { angle: "front", crop: tiny, rect: { x: 0, y: 0, w: 640, h: 640 }, frame: { w: 640, h: 640 } };
    expect(rowsToMarks(new Float32Array([10, 10, 20, 20, 0.2, 0, 0, 0, 0, 0, 0, 0]), input, letterbox(640, 640), 0.35)).toEqual([]);
  });

  it("pads with ultralytics grey outside the crop", () => {
    const t = toTensorData({ data: new Uint8ClampedArray([255, 0, 0, 255]), width: 1, height: 1 }, { scale: 1, padX: 0, padY: 0 });
    expect(t[0]).toBe(1);
    expect(t[1]).toBeCloseTo(114 / 255);
  });
});

describe("Shades-of-Grey parity with ai/training/transforms.py", () => {
  it("matches the Python fixture within one level", () => {
    // shades_of_gray() output for this 2x3 RGB image, generated 2026-09-26.
    const input = [[200, 150, 100], [180, 140, 90], [220, 170, 120], [90, 70, 50], [250, 200, 150], [120, 100, 70]];
    const expected = [[161, 153, 140], [144, 143, 126], [177, 174, 168], [72, 71, 70], [201, 204, 211], [96, 102, 98]];
    const px = { data: new Uint8ClampedArray(input.flatMap((p) => [...p, 255])), width: 3, height: 2 };
    shadesOfGrey(px);
    input.forEach((_, i) => {
      for (let c = 0; c < 3; c++) expect(Math.abs(px.data[i * 4 + c] - expected[i][c])).toBeLessThanOrEqual(1);
    });
  });

  it("leaves a grey image unchanged", () => {
    const px = { data: new Uint8ClampedArray([128, 128, 128, 255, 128, 128, 128, 255]), width: 2, height: 1 };
    shadesOfGrey(px);
    expect(Array.from(px.data)).toEqual([128, 128, 128, 255, 128, 128, 128, 255]);
  });
});
