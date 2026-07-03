import { describe, it, expect } from "vitest";
import { stripMetadata, RedactError, type ImageCodec } from "./redact";

const fakeCodec: ImageCodec = {
  async decode(blob) {
    return { width: 10, height: 20, source: blob };
  },
  async encode(_bitmap, mimeType) {
    // Simulate a clean, metadata-free re-encode.
    return new Blob(["clean-pixels"], { type: mimeType });
  },
};

describe("stripMetadata", () => {
  it("returns a re-encoded blob with the requested mime type and dimensions", async () => {
    const dirty = new Blob(["jpeg-with-exif-gps"], { type: "image/jpeg" });
    const result = await stripMetadata(dirty, "image/jpeg", fakeCodec);
    expect(result.mimeType).toBe("image/jpeg");
    expect(result.width).toBe(10);
    expect(result.height).toBe(20);
    expect(await result.blob.text()).toBe("clean-pixels");
  });

  it("rejects non-image blobs", async () => {
    const bad = new Blob(["not-an-image"], { type: "application/pdf" });
    await expect(stripMetadata(bad, "image/jpeg", fakeCodec)).rejects.toThrow(
      /not an image/i,
    );
  });
});

describe("stripMetadata — codec failures", () => {
  it("wraps decode failures in RedactError with a clear message", async () => {
    const failingCodec: ImageCodec = {
      async decode() {
        throw new DOMException("The source image could not be decoded.");
      },
      async encode() {
        throw new Error("unreachable");
      },
    };
    const blob = new Blob(["corrupt"], { type: "image/jpeg" });
    await expect(stripMetadata(blob, "image/jpeg", failingCodec)).rejects.toThrow(
      RedactError,
    );
    await expect(stripMetadata(blob, "image/jpeg", failingCodec)).rejects.toThrow(
      /could not process this photo/i,
    );
  });
});
