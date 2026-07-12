// ai/face/stats.ts
// Single pixel pass per zone → ZoneStats. Analyzers never touch pixels directly.
import type { FaceAnalysisZone } from "../../shared/face";
import type { Pixels, ZoneStats } from "./types";

export function zoneStats(zone: FaceAnalysisZone, px: Pixels, mask: Uint8Array): ZoneStats {
  const { data, width, height } = px;
  let n = 0, sumR = 0, sumG = 0, sumB = 0, sumLuma = 0, sumLuma2 = 0, sumRedIdx = 0;
  const lumas = new Float32Array(width * height);
  const redIdxs = new Float32Array(width * height);

  for (let p = 0; p < width * height; p++) {
    if (!mask[p]) continue;
    const i = p * 4;
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const luma = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    const redIdx = Math.max(0, (r - (g + b) / 2) / 255);
    lumas[p] = luma; redIdxs[p] = redIdx;
    n++; sumR += r; sumG += g; sumB += b;
    sumLuma += luma; sumLuma2 += luma * luma; sumRedIdx += redIdx;
  }
  if (n === 0) {
    return { zone, pixelCount: 0, meanR: 0, meanG: 0, meanB: 0, meanLuma: 0, lumaStd: 0,
      rednessIdx: 0, highFreqRatio: 0, darkSpotRatio: 0, brightSpotRatio: 0, redSpotRatio: 0 };
  }
  const meanLuma = sumLuma / n;
  const lumaStd = Math.sqrt(Math.max(0, sumLuma2 / n - meanLuma * meanLuma));
  const rednessIdx = sumRedIdx / n;

  let hf = 0, dark = 0, bright = 0, redSpot = 0;
  const darkT = meanLuma - 2 * lumaStd, brightT = meanLuma + 2 * lumaStd, redT = rednessIdx + 0.08;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = y * width + x;
      if (!mask[p]) continue;
      let nbSum = 0, nb = 0;
      if (x > 0 && mask[p - 1]) { nbSum += lumas[p - 1]; nb++; }
      if (x < width - 1 && mask[p + 1]) { nbSum += lumas[p + 1]; nb++; }
      if (y > 0 && mask[p - width]) { nbSum += lumas[p - width]; nb++; }
      if (y < height - 1 && mask[p + width]) { nbSum += lumas[p + width]; nb++; }
      if (nb > 0) hf += Math.abs(lumas[p] - nbSum / nb);
      if (lumas[p] < darkT) dark++;
      if (lumas[p] > brightT) bright++;
      if (redIdxs[p] > redT) redSpot++;
    }
  }
  return {
    zone, pixelCount: n,
    meanR: sumR / n, meanG: sumG / n, meanB: sumB / n,
    meanLuma, lumaStd, rednessIdx,
    highFreqRatio: hf / n,
    darkSpotRatio: dark / n,
    brightSpotRatio: bright / n,
    redSpotRatio: redSpot / n,
  };
}
