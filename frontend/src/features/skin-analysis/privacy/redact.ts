import type { CaptureResult } from "../types";

export class RedactError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "RedactError";
  }
}

export interface DecodedBitmap {
  width: number;
  height: number;
  source: unknown;
}

export interface ImageCodec {
  decode(blob: Blob): Promise<DecodedBitmap>;
  encode(bitmap: DecodedBitmap, mimeType: string): Promise<Blob>;
}

export interface RedactResult {
  blob: Blob;
  mimeType: string;
  width: number;
  height: number;
}

export async function stripMetadata(
  input: Blob,
  mimeType: string,
  codec: ImageCodec,
): Promise<RedactResult> {
  if (!input.type.startsWith("image/")) {
    throw new Error("File is not an image");
  }
  try {
    const bitmap = await codec.decode(input);
    const clean = await codec.encode(bitmap, mimeType);
    return { blob: clean, mimeType, width: bitmap.width, height: bitmap.height };
  } catch (err) {
    throw new RedactError("Could not process this photo — it may be corrupt or unsupported.", {
      cause: err,
    });
  }
}

export function toCaptureResult(
  r: RedactResult,
  mode: CaptureResult["mode"],
  source: CaptureResult["source"],
): CaptureResult {
  return {
    blob: r.blob,
    mimeType: r.mimeType,
    mode,
    source,
    width: r.width,
    height: r.height,
  };
}

export const canvasCodec: ImageCodec = {
  async decode(blob) {
    const bitmap = await createImageBitmap(blob, { imageOrientation: "from-image" });
    return { width: bitmap.width, height: bitmap.height, source: bitmap };
  },
  async encode(bitmap, mimeType) {
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("2D canvas unavailable");
    ctx.drawImage(bitmap.source as CanvasImageSource, 0, 0);
    (bitmap.source as ImageBitmap).close?.();
    const blob: Blob | null = await new Promise((res) =>
      canvas.toBlob(res, mimeType, 0.92),
    );
    if (!blob) throw new Error("Canvas encode failed");
    return blob;
  },
};
