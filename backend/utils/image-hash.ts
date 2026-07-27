import sharp from "sharp";

// Perceptual difference-hash (dHash) for near-duplicate detection.
//
// Downscale to 9x8 greyscale and record whether each pixel is brighter than its
// right-hand neighbour → 64 bits. Robust to re-compression, small exposure and
// scale changes, but different photos of the same face still differ, which is
// exactly the line we want: catch the same shot submitted twice, not two real
// visits by the same patient.
const W = 9;
const H = 8;

export async function dHash(jpeg: Uint8Array | Buffer): Promise<string | null> {
  try {
    const raw = await sharp(Buffer.from(jpeg))
      .greyscale()
      .resize(W, H, { fit: "fill" })
      .raw()
      .toBuffer();
    let bits = "";
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W - 1; x++) {
        bits += raw[y * W + x] > raw[y * W + x + 1] ? "1" : "0";
      }
    }
    // 64 bits → 16 hex chars.
    let hex = "";
    for (let i = 0; i < bits.length; i += 4) hex += parseInt(bits.slice(i, i + 4), 2).toString(16);
    return hex;
  } catch {
    return null;
  }
}

/** Fraction of matching bits, 0..1. Same image → 1. */
export function hashSimilarity(a: string, b: string): number {
  if (!a || !b || a.length !== b.length) return 0;
  let same = 0;
  for (let i = 0; i < a.length; i++) {
    const x = parseInt(a[i], 16) ^ parseInt(b[i], 16);
    // Count matching bits in this nibble (4 bits per hex char).
    same += 4 - ((x & 1) + ((x >> 1) & 1) + ((x >> 2) & 1) + ((x >> 3) & 1));
  }
  return same / (a.length * 4);
}
