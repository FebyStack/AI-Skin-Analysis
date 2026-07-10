import type { QualityIssue, QualityReport } from "../../shared/types";

export const QUALITY_THRESHOLDS = {
  minBrightness: 0.15,
  maxBrightness: 0.95,
  minSharpness: 0.008,
  minDimensionPx: 320,
  minSkinCoverage: 0.03,
  minAspectRatio: 0.6,
  maxAspectRatio: 1.8,
  maxGlareRatio: 0.08,
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

export function estimateSkinCoverage(rgba: Uint8ClampedArray): number {
  const pixels = rgba.length / 4;
  if (pixels === 0) return 0;
  let skin = 0;
  for (let i = 0; i < rgba.length; i += 4) {
    const r = rgba[i];
    const g = rgba[i + 1];
    const b = rgba[i + 2];
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
    const cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;
    if (
      r > 20 &&
      g > 20 &&
      b > 5 &&
      max - min > 10 &&
      cb >= 77 &&
      cb <= 127 &&
      cr >= 133 &&
      cr <= 173
    ) {
      skin++;
    }
  }
  return skin / pixels;
}

export function estimateGlareRatio(rgba: Uint8ClampedArray): number {
  const pixels = rgba.length / 4;
  if (pixels === 0) return 0;
  let glare = 0;
  for (let i = 0; i < rgba.length; i += 4) {
    const r = rgba[i];
    const g = rgba[i + 1];
    const b = rgba[i + 2];
    const luma = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    const spread = Math.max(r, g, b) - Math.min(r, g, b);
    if (luma > 0.95 && spread < 20) glare++;
  }
  return glare / pixels;
}

function joinReasons(labels: string[]): string {
  if (labels.length === 0) return "";
  if (labels.length === 1) return labels[0];
  if (labels.length === 2) return `${labels[0]} and ${labels[1]}`;
  return `${labels.slice(0, -1).join(", ")}, and ${labels.at(-1)}`;
}

export function buildQualityGuidance(issues: QualityIssue[]): string {
  const unique = [...new Set(issues)];
  if (unique.length === 0) return "This photo cannot be analyzed yet.";
  const reasons = unique.map((issue) => {
    switch (issue) {
      case "too-dark":
        return "too dark";
      case "too-bright":
        return "too bright";
      case "blur":
        return "blurry";
      case "low-resolution":
        return "low-resolution";
      case "glare":
        return "too much glare";
      case "no-region":
        return "no clear skin region";
      case "unsupported-aspect-ratio":
        return "an unsupported aspect ratio";
    }
  });
  const tips: string[] = [];
  if (unique.some((issue) => issue === "too-dark" || issue === "too-bright" || issue === "glare")) {
    tips.push("Use even, indirect light and avoid flash reflections.");
  }
  if (unique.includes("blur")) {
    tips.push("Hold the camera steady and let it focus before taking the photo.");
  }
  if (unique.includes("low-resolution")) {
    tips.push("Use a higher-resolution camera or move closer.");
  }
  if (unique.includes("no-region")) {
    tips.push("Fill more of the frame with the skin area you want analyzed.");
  }
  if (unique.includes("unsupported-aspect-ratio")) {
    tips.push("Retake in portrait or square framing.");
  }
  return `This photo cannot be analyzed yet because it is ${joinReasons(reasons)}. ${tips.join(" ")}`.trim();
}

export interface QualityMetrics {
  brightness: number;
  sharpness: number;
  regionFound: boolean;
  width: number;
  height: number;
  glareRatio: number;
  skinCoverage: number;
}

export function assessQuality(
  m: QualityMetrics,
  t = QUALITY_THRESHOLDS,
): QualityReport {
  const issues: QualityIssue[] = [];
  const aspectRatio = m.height > 0 ? m.width / m.height : 0;
  if (m.brightness < t.minBrightness) issues.push("too-dark");
  if (m.brightness > t.maxBrightness) issues.push("too-bright");
  if (m.sharpness < t.minSharpness) issues.push("blur");
  if (Math.min(m.width, m.height) < t.minDimensionPx) issues.push("low-resolution");
  if (m.glareRatio > t.maxGlareRatio) issues.push("glare");
  if (!m.regionFound || m.skinCoverage < t.minSkinCoverage) issues.push("no-region");
  if (aspectRatio < t.minAspectRatio || aspectRatio > t.maxAspectRatio) {
    issues.push("unsupported-aspect-ratio");
  }
  return {
    ok: issues.length === 0,
    issues,
    guidance: issues.length === 0 ? "" : buildQualityGuidance(issues),
    brightness: m.brightness,
    sharpness: m.sharpness,
    regionFound: m.regionFound,
    width: m.width,
    height: m.height,
    aspectRatio,
    glareRatio: m.glareRatio,
    skinCoverage: m.skinCoverage,
  };
}
