import { describe, it, expect } from "vitest";
import sharp from "sharp";
import { compressToJpeg, MAX_EDGE_PX } from "./image";

async function makePng(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: { r: 180, g: 140, b: 120 } },
  })
    .png()
    .toBuffer();
}

describe("compressToJpeg", () => {
  it("downscales the long edge to MAX_EDGE_PX and outputs jpeg", async () => {
    const big = await makePng(4000, 2000);
    const out = await compressToJpeg(big);
    expect(out.width).toBe(MAX_EDGE_PX);
    expect(out.height).toBe(Math.round((MAX_EDGE_PX * 2000) / 4000));
    const meta = await sharp(out.jpeg).metadata();
    expect(meta.format).toBe("jpeg");
  });

  it("does not upscale small images", async () => {
    const small = await makePng(400, 300);
    const out = await compressToJpeg(small);
    expect(out.width).toBe(400);
    expect(out.height).toBe(300);
  });

  it("produces a materially smaller file for large inputs", async () => {
    const big = await makePng(4000, 4000);
    const out = await compressToJpeg(big);
    expect(out.jpeg.byteLength).toBeLessThan(big.byteLength);
    expect(out.jpeg.byteLength).toBeLessThan(600 * 1024);
  });

  it("strips metadata by re-encoding", async () => {
    const withExif = await sharp(await makePng(800, 600))
      .withMetadata({ exif: { IFD0: { Copyright: "secret" } } })
      .jpeg()
      .toBuffer();
    const out = await compressToJpeg(withExif);
    const meta = await sharp(out.jpeg).metadata();
    expect(meta.exif).toBeUndefined();
  });
});
