import type { QualityIssue, QualityReport } from "../types";

export const QUALITY_THRESHOLDS = {
  minBrightness: 0.15,
  maxBrightness: 0.95,
  minSharpness: 0.02,
};

export function meanLuma(rgba: Uint8ClampedArray): number {
  const n = rgba.length / 4;
  if (n === 0) return 0;
  let sum = 0;
  for (let i = 0; i < rgba.length; i += 4) {
    sum += 0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2];
  }
  return sum / n / 255;
}

// gray: 0..1 luma per pixel, row-major. Mean absolute neighbour gradient.
export function estimateSharpness(gray: number[], width: number, height: number): number {
  if (width < 2 || height < 2) return 0;
  let sum = 0;
  let count = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width - 1; x++) {
      sum += Math.abs(gray[y * width + x] - gray[y * width + x + 1]);
      count++;
    }
  }
  return count === 0 ? 0 : sum / count;
}

export function assessQuality(
  m: { brightness: number; sharpness: number; regionFound: boolean },
  t = QUALITY_THRESHOLDS,
): QualityReport {
  const issues: QualityIssue[] = [];
  if (m.brightness < t.minBrightness) issues.push("too-dark");
  if (m.brightness > t.maxBrightness) issues.push("overexposed");
  if (m.sharpness < t.minSharpness) issues.push("blur");
  if (!m.regionFound) issues.push("no-region");
  return {
    ok: issues.length === 0,
    issues,
    brightness: m.brightness,
    sharpness: m.sharpness,
    regionFound: m.regionFound,
  };
}
