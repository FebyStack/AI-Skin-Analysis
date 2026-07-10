import { describe, it, expect } from "vitest";
import { pigmentationMap, rednessMap, textureMap } from "./derived-views";

function px(r: number, g: number, b: number): Uint8ClampedArray {
  return new Uint8ClampedArray([r, g, b, 255]);
}

describe("pigmentationMap", () => {
  it("scores brown/pigmented pixels above neutral gray", () => {
    const brown = pigmentationMap(px(120, 72, 40))[0];
    const gray = pigmentationMap(px(128, 128, 128))[0];
    expect(brown).toBeGreaterThan(gray);
  });
});

describe("rednessMap", () => {
  it("scores red/erythema pixels above neutral gray", () => {
    const red = rednessMap(px(200, 90, 90))[0];
    const gray = rednessMap(px(128, 128, 128))[0];
    expect(red).toBeGreaterThan(gray);
  });
});

describe("textureMap", () => {
  it("is ~0 on a flat field and higher on an edge", () => {
    const flat = new Uint8ClampedArray(2 * 2 * 4).fill(128);
    for (let i = 3; i < flat.length; i += 4) flat[i] = 255;
    const edgy = new Uint8ClampedArray([0, 0, 0, 255, 255, 255, 255, 255, 0, 0, 0, 255, 255, 255, 255, 255]);
    const flatMax = Math.max(...textureMap(flat, 2, 2));
    const edgyMax = Math.max(...textureMap(edgy, 2, 2));
    expect(flatMax).toBe(0);
    expect(edgyMax).toBeGreaterThan(flatMax);
  });
});
