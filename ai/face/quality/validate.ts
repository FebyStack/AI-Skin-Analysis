// ai/face/quality/validate.ts
// Per-image gate. Every threshold is a named, tunable constant.
import type { FaceAngle, AngleQuality } from "../../../shared/face";
import type { FaceGeometry, Pixels } from "../types";

export const MIN_EDGE_PX = 480;
export const LUMA_MIN = 0.15;
export const LUMA_MAX = 0.9;
export const BLUR_MIN_HF = 0.004;       // mean |luma - neighbour mean| over the whole frame
export const FACE_MIN_FRACTION = 0.2;   // face bbox height / image height (plan said 0.18; fixture scale 0.08 spans 0.1934, tuned up)
export const ANGLE_YAW_WINDOWS: Record<FaceAngle, [number, number]> = {
  front: [-12, 12], "left-45": [-60, -30], "right-45": [30, 60],
  "left-profile": [-95, -65], "right-profile": [65, 95],
};

function frameLumaStats(px: Pixels): { mean: number; hf: number } {
  const { data, width, height } = px;
  const lumas = new Float32Array(width * height);
  let sum = 0;
  for (let p = 0; p < width * height; p++) {
    const i = p * 4;
    lumas[p] = (0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]) / 255;
    sum += lumas[p];
  }
  let hf = 0, cnt = 0;
  for (let y = 1; y < height - 1; y += 2) {       // stride 2: cheap
    for (let x = 1; x < width - 1; x += 2) {
      const p = y * width + x;
      const nbMean = (lumas[p - 1] + lumas[p + 1] + lumas[p - width] + lumas[p + width]) / 4;
      hf += Math.abs(lumas[p] - nbMean); cnt++;
    }
  }
  return { mean: sum / (width * height), hf: cnt ? hf / cnt : 0 };
}

function faceFraction(g: FaceGeometry): number {
  let minY = 1, maxY = 0;
  for (const l of g.landmarks) { if (l.y < minY) minY = l.y; if (l.y > maxY) maxY = l.y; }
  return maxY - minY;
}

export function validateCapture(angle: FaceAngle, px: Pixels, geometry: FaceGeometry | null): AngleQuality {
  const issues: string[] = [];
  if (Math.min(px.width, px.height) < MIN_EDGE_PX) issues.push("low-resolution");
  const { mean, hf } = frameLumaStats(px);
  if (mean < LUMA_MIN) issues.push("too-dark");
  if (mean > LUMA_MAX) issues.push("too-bright");
  if (hf < BLUR_MIN_HF) issues.push("blur");
  if (!geometry) {
    issues.push("no-face");
    return { ok: false, issues };
  }
  const [lo, hi] = ANGLE_YAW_WINDOWS[angle];
  if (geometry.yawDeg < lo || geometry.yawDeg > hi) issues.push("wrong-orientation");
  if (faceFraction(geometry) < FACE_MIN_FRACTION) issues.push("face-too-small");
  return { ok: issues.length === 0, issues };
}
