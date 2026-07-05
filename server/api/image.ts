import sharp from "sharp";

export const MAX_EDGE_PX = 1280;
export const JPEG_QUALITY = 80;

export interface CompressedImage {
  jpeg: Buffer;
  width: number;
  height: number;
}

// Re-encode to JPEG: downscale long edge to MAX_EDGE_PX (never upscale),
// quality 80, no metadata (sharp drops EXIF unless withMetadata is called).
export async function compressToJpeg(input: Buffer): Promise<CompressedImage> {
  const out = await sharp(input)
    .rotate() // apply EXIF orientation before it is discarded
    .resize(MAX_EDGE_PX, MAX_EDGE_PX, { fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: JPEG_QUALITY, mozjpeg: true })
    .toBuffer({ resolveWithObject: true });
  return { jpeg: out.data, width: out.info.width, height: out.info.height };
}
