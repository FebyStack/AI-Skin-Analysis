// shared/image-quality.ts
// Scores a captured angle 0–100 from the raw measurements taken at capture time
// (shared/face.ts QualityMetrics), so the Training Queue can show a reviewer why
// a sample is weak without re-decoding the image.
//
// Each check is scored independently and averaged, so one bad axis can't hide
// behind four good ones — and the reviewer sees exactly which axis failed.
import type { AngleQuality, QualityMetrics } from "./face";

export const QUALITY_MIN_SCORE = 70; // below this the sample is flagged

export interface QualityCheck {
  key: "lighting" | "blur" | "centering" | "distance" | "resolution";
  label: string;
  score: number; // 0..100
  ok: boolean;
  detail: string;
}

export interface QualityResult {
  score: number; // 0..100 overall
  ok: boolean;
  checks: QualityCheck[];
}

/** Linear 0..100 for "bigger is better", saturating at `good`. */
function ramp(value: number, bad: number, good: number): number {
  if (good === bad) return 100;
  const t = (value - bad) / (good - bad);
  return Math.round(Math.max(0, Math.min(1, t)) * 100);
}

/** 100 at `ideal`, falling to 0 at `ideal ± tolerance`. */
function band(value: number, ideal: number, tolerance: number): number {
  return Math.round(Math.max(0, 1 - Math.abs(value - ideal) / tolerance) * 100);
}

export function scoreQuality(m: QualityMetrics): QualityResult {
  const checks: QualityCheck[] = [
    {
      key: "lighting",
      label: "Lighting",
      score: band(m.luma, 0.5, 0.35),
      ok: m.luma >= 0.15 && m.luma <= 0.9,
      detail: m.luma < 0.15 ? "Too dark" : m.luma > 0.9 ? "Too bright" : "Well exposed",
    },
    {
      key: "blur",
      label: "Blur",
      score: ramp(m.sharpness, 0.002, 0.012),
      ok: m.sharpness >= 0.004,
      detail: m.sharpness < 0.004 ? "Soft / motion blur" : "Sharp",
    },
    {
      key: "centering",
      label: "Face Centering",
      score: ramp(1 - m.centerOffset, 0.6, 0.95),
      ok: m.centerOffset <= 0.4,
      detail: m.centerOffset > 0.4 ? "Face off-centre" : "Centred",
    },
    {
      key: "distance",
      label: "Distance",
      score: band(m.faceFraction, 0.55, 0.45),
      ok: m.faceFraction >= 0.2,
      detail:
        m.faceFraction < 0.2 ? "Too far away" : m.faceFraction > 0.9 ? "Too close" : "Good framing",
    },
    {
      key: "resolution",
      label: "Resolution",
      score: ramp(m.minEdge, 320, 900),
      ok: m.minEdge >= 480,
      detail: m.minEdge < 480 ? `Low (${m.minEdge}px)` : `${m.minEdge}px`,
    },
  ];
  const score = Math.round(checks.reduce((a, c) => a + c.score, 0) / checks.length);
  // A hard failure on any axis caps the sample as not-ok regardless of the mean.
  return { score, ok: score >= QUALITY_MIN_SCORE && checks.every((c) => c.ok), checks };
}

/** Best-effort score for a stored angle; null when the capture predates metrics. */
export function scoreAngle(q: AngleQuality | undefined | null): QualityResult | null {
  return q?.metrics ? scoreQuality(q.metrics) : null;
}
